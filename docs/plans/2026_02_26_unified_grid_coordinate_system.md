# Unified Grid Coordinate System for Items

**Date:** 2026-02-26  
**Status:** Planning Phase  
**Priority:** Critical  
**Estimated Duration:** 2-3 Days  
**Type:** Comprehensive Refactor  
**Related Plans:** 2026_02_22_character_module_rework.md, 2026_02_19_inventory_movement_plan.md

---

## 1. Executive Summary

### The Problem
The current item system has **dual storage modes**: items can either have `grid_x`/`grid_y` coordinates (sparse placement) or use packed array indices. This creates:
- Complex dual-path logic throughout the codebase
- Bugs when items lack grid coordinates
- Confusion about which system is "correct"
- Inconsistent behavior between container types

### The Solution
Migrate to a **unified grid coordinate system** where:
- **ALL items MUST have `grid_x` and `grid_y` coordinates** (required fields)
- **NO packed array fallback** - single code path everywhere
- **All transfers use grid coordinates** - simplified logic
- **One consistent storage format** across all containers

### Current State
- ❌ Grid coordinates are OPTIONAL (`grid_x?: number`)
- ❌ Packed array fallback creates dual code paths
- ❌ Items without grid coordinates behave inconsistently
- ❌ Transfer logic is complex with multiple branches
- ❌ No items in current saves have grid coordinates
- ❌ Nested containers bypass grid system entirely

### Target State
- ✅ `grid_x` and `grid_y` are REQUIRED fields
- ✅ All items have grid coordinates (migration handles existing)
- ✅ Single unified transfer logic (remove packed fallback)
- ✅ All containers support sparse placement
- ✅ Simplified, maintainable codebase

### Scope
- **All containers:** Player inventories, NPC inventories, ground containers, nested containers
- **All item operations:** Creation, transfer, stacking, splitting, equipping
- **All entity types:** Actors, NPCs, Places

---

## 2. Why This Matters

### Current Pain Points

**1. Dual Code Paths = Bugs**
```typescript
// Current transfer logic has THREE branches:
if (is_same_container && has_grid_coords) {
    // Grid-based sparse placement
} else if (is_same_container) {
    // Packed array manipulation (fallback)
} else {
    // Cross-container transfer (packed)
}
```

**2. Inconsistent Behavior**
- Same-container transfers: Sometimes sparse, sometimes packed
- Cross-container transfers: Always packed (items always stack at front)
- Nested containers: Never use grid coordinates

**3. Developer Confusion**
- "Should I use grid_x/y or slot_index?"
- "Why does this item not have coordinates?"
- "Which code path is this transfer taking?"

### Benefits of Unified System

**1. Simplicity**
- One code path for ALL transfers
- No fallback logic
- Clear, predictable behavior

**2. Consistency**
- All items behave the same way
- All containers support sparse placement
- No special cases

**3. Maintainability**
- Easier to understand and debug
- Fewer edge cases
- Clear data model

**4. Future-Proof**
- Foundation for advanced features (sorting, organizing)
- Consistent API for all operations
- No technical debt from dual systems

---

## 3. Technical Changes Required

### 3.1 Type System Changes

**Make grid_x and grid_y REQUIRED:**

```typescript
// BEFORE (Current)
export interface ContainerContentEntry {
    instance: ItemInstance;
    definition: ItemDefinition;
    grid_x?: number;  // Optional - item may not have coordinates
    grid_y?: number;  // Optional - item may not have coordinates
}

// AFTER (Unified)
export interface ContainerContentEntry {
    instance: ItemInstance;
    definition: ItemDefinition;
    grid_x: number;   // REQUIRED - all items have coordinates
    grid_y: number;   // REQUIRED - all items have coordinates
}
```

### 3.2 API Changes

**Remove slot_index, Make grid Coordinates Required:**

```typescript
// BEFORE (Current)
interface TransferRequest {
    item_instance_id: string;
    from_container: string;
    to_container: string;
    from_slot_index?: number;  // Optional
    to_slot_index?: number;    // Optional
    target_grid_x?: number;    // Optional
    target_grid_y?: number;    // Optional
}

// AFTER (Unified)
interface TransferRequest {
    item_instance_id: string;
    from_container: string;
    to_container: string;
    target_grid_x: number;     // REQUIRED
    target_grid_y: number;     // REQUIRED
}
```

### 3.3 Transfer Logic Simplification

**Remove All Packed Fallback Logic:**

```typescript
// BEFORE (Current - Complex)
export function transfer_item_between_containers(
    // ... parameters
): { ok: boolean; error?: string } {
    // 1. Same container + has grid coords → Grid placement
    if (is_same_container && target_grid_x !== undefined && target_grid_y !== undefined) {
        // ... sparse placement logic
    }
    // 2. Same container + no grid coords → Packed array
    else if (is_same_container) {
        // ... packed array manipulation
    }
    // 3. Cross-container → Push to destination
    else {
        // ... push to destination array
    }
}

// AFTER (Unified - Simple)
export function transfer_item_between_containers(
    // ... parameters (grid_x and grid_y always provided)
): { ok: boolean; error?: string } {
    // Single path: Always use grid coordinates
    // 1. Find item at source grid position
    // 2. Check target grid position is valid/empty
    // 3. Move item to target position
    // 4. Update grid_x and grid_y
}
```

### 3.4 Item Creation Updates

**ALL Item Creation MUST Provide Grid Coordinates:**

```typescript
// BEFORE (Current)
export function create_inline_item(
    def_id: string,
    qty: number = 1,
    owner_ref: string = "system",
    container_id: string = "",
    condition: ItemInstance["condition"] = "good"
): ItemInstance

// AFTER (Unified)
export function create_inline_item(
    def_id: string,
    qty: number = 1,
    owner_ref: string = "system",
    container_id: string = "",
    condition: ItemInstance["condition"] = "good",
    grid_x: number,           // REQUIRED
    grid_y: number            // REQUIRED
): ItemInstance
```

---

## 4. Data Migration Strategy

### 4.1 The Problem

**Current State:**
- Zero items in existing saves have grid coordinates
- All items use packed array storage
- Grid coordinates are `undefined` for all items

**Target State:**
- All items MUST have valid grid coordinates
- Migration assigns coordinates based on current array position

### 4.2 Migration Approach

**Option: On-Load Migration (Recommended)**

```typescript
// In container loading/initialization
function ensure_grid_coordinates(
    contents: ContainerContentEntry[],
    cols: number
): void {
    contents.forEach((entry, index) => {
        if (entry.grid_x === undefined || entry.grid_y === undefined) {
            // Assign coordinates based on array index
            entry.grid_x = index % cols;
            entry.grid_y = Math.floor(index / cols);
            
            debug_log("Migration", 
                `Assigned grid(${entry.grid_x},${entry.grid_y}) to item ${entry.instance.def_id}`);
        }
    });
}
```

**Benefits:**
- ✅ Automatic - no manual intervention
- ✅ Backward compatible during transition
- ✅ Happens once per container
- ✅ Can be removed later once all data migrated

**Alternative: One-Time Migration Tool**
- Run once to update all entity files
- Faster runtime (no on-load overhead)
- Requires explicit action

### 4.3 Migration Algorithm

**For Each Container:**
1. Calculate grid dimensions from `max_slots`
2. For each item in `contents` (by index):
   - If `grid_x`/`grid_y` missing:
     - `grid_x = index % cols`
     - `grid_y = Math.floor(index / cols)`
3. Recursively process nested containers (`container_data`)

**Edge Cases:**
- **More items than slots:** Assign coordinates anyway (may overflow grid visually)
- **Nested containers:** Process parent first, then recursively process each nested container
- **Body slots:** Same algorithm (even though typically 1 slot)

### 4.4 Migration Safety

**Pre-Migration:**
- [ ] Backup all entity files
- [ ] Test migration on copy of data
- [ ] Verify no data loss

**During Migration:**
- [ ] Log all assignments
- [ ] Handle errors gracefully
- [ ] Don't fail entire operation on one bad container

**Post-Migration:**
- [ ] Verify item counts match
- [ ] Spot-check coordinates
- [ ] Test save/load cycle

---

## 5. Implementation Phases

### Phase 1: Foundation (Day 1 Morning)
**Goal:** Prepare unified system infrastructure

**1. Type Definitions**
- [ ] Update `ContainerContentEntry` interface (make grid_x/y required)
- [ ] Update TypeScript types throughout
- [ ] Verify compilation catches all missing coordinates

**2. Migration Logic**
- [ ] Implement `ensure_grid_coordinates()` function
- [ ] Add to container loading/initialization
- [ ] Add comprehensive logging

**3. Grid Calculator**
- [ ] Verify `get_container_grid()` works for all container types
- [ ] Test edge cases (1 slot, max slots, etc.)

**Testing:**
- [ ] Test migration on sample data
- [ ] Verify backward compatibility
- [ ] Check performance impact

---

### Phase 2: Item Creation Updates (Day 1 Afternoon)
**Goal:** All new items get grid coordinates

**1. Core Creation Functions**
- [ ] Update `create_inline_item()` to require grid_x/y
- [ ] Update `create_container_item()` to require grid_x/y
- [ ] Update `add_item_to_container()` to require grid_x/y

**2. Creation Call Sites**
- [ ] Update `generate_container_system.ts` (NPC generation)
- [ ] Update `add_ground_item.ts` (ground items)
- [ ] Find and update ALL other creation sites

**3. Default Position Strategy**
- [ ] Decide: First empty slot? Next available position?
- [ ] Implement `find_empty_grid_position()` helper
- [ ] Document the strategy

**Testing:**
- [ ] Create new items in various containers
- [ ] Verify coordinates assigned
- [ ] Test edge cases (full containers)

---

### Phase 3: Transfer Logic (Day 2 Morning)
**Goal:** Unified transfer system

**1. Backend Transfer Function**
- [ ] Remove packed fallback branch from `store.ts`
- [ ] Simplify to single grid-based path
- [ ] Update function signature (remove optional grid params)

**2. API Updates**
- [ ] Update `/api/transfer` endpoint (make grid_x/y required)
- [ ] Remove `slot_index` handling
- [ ] Update validation

**3. Frontend Updates**
- [ ] Update ALL transfer calls in `app_state.ts`
- [ ] Always calculate and send grid coordinates
- [ ] Remove slot_index from requests

**Testing:**
- [ ] Test same-container transfers
- [ ] Test cross-container transfers
- [ ] Test body slot transfers
- [ ] Test stacking

---

### Phase 4: Nested Containers & Edge Cases (Day 2 Afternoon)
**Goal:** Handle complex scenarios

**1. Nested Container Support**
- [ ] Ensure grid coordinates saved in `container_data`
- [ ] Test nested container transfers
- [ ] Verify recursive migration works

**2. Body Slot Handling**
- [ ] Test equip/unequip with grid coordinates
- [ ] Verify body slot swaps work
- [ ] Ensure single-slot containers work

**3. Stacking Logic**
- [ ] Decide: Move stack to drop position or stay at original?
- [ ] Update stacking to handle coordinates
- [ ] Test stacking behavior

**Testing:**
- [ ] Complex transfer scenarios
- [ ] Edge cases (full containers, invalid positions)
- [ ] Performance testing

---

### Phase 5: Cleanup & Documentation (Day 3 Morning)
**Goal:** Production-ready code

**1. Remove Dead Code**
- [ ] Remove packed array fallback branches
- [ ] Remove slot_index from all APIs
- [ ] Clean up debug logging

**2. Documentation**
- [ ] Update AGENTS.md with coordinate system
- [ ] Document new API format
- [ ] Add inline code comments

**3. Testing**
- [ ] Full regression test suite
- [ ] Performance benchmarks
- [ ] Verify no console errors

---

## 6. Files to Modify

### Core Storage (High Impact)
| File | Changes | Risk |
|------|---------|------|
| `src/types/container.ts` | Make grid_x/y required | Medium |
| `src/container_storage/store.ts` | Remove packed fallback, update transfer | High |
| `src/item_instances/store.ts` | Add grid params to creation | Medium |
| `src/container_storage/grid_calculator.ts` | No changes needed | None |

### Interface Layer (Medium Impact)
| File | Changes | Risk |
|------|---------|------|
| `src/interface_program/main.ts` | Update transfer API | Medium |
| `src/canvas_app/app_state.ts` | Update all transfer calls | Medium |
| `src/mono_ui/modules/container_module.ts` | No changes (already works) | None |
| `src/mono_ui/modules/character_module.ts` | No changes (already works) | None |

### Tools & Generation (Medium Impact)
| File | Changes | Risk |
|------|---------|------|
| `src/tools/generate_container_system.ts` | Add grid coordinates | Medium |
| `src/tools/add_ground_item.ts` | Add grid coordinates | Medium |
| `src/tools/migrate_to_grid_coords.ts` | **NEW** Migration tool | Low |

### Migration (One-Time)
| File | Purpose | Risk |
|------|---------|------|
| `src/shared/migration.ts` | On-load migration logic | Low |

---

## 7. Risk Assessment

### HIGH Risk

**1. Data Migration**
- **Risk:** Corrupted saves if migration fails
- **Mitigation:** 
  - Backup all data before migration
  - Test on copy first
  - Comprehensive logging
  - Graceful error handling

**2. Transfer Logic Changes**
- **Risk:** Items lost or misplaced during transfers
- **Mitigation:**
  - Extensive testing
  - Audit logs
  - Transaction-like operations (verify before commit)

**3. API Changes**
- **Risk:** Frontend/backend mismatch during deployment
- **Mitigation:**
  - Deploy backend first (accepts both old and new)
  - Then deploy frontend (sends new format)
  - Or deploy atomically

### MEDIUM Risk

**4. Item Creation Sites**
- **Risk:** Missing some creation points
- **Mitigation:**
  - Comprehensive grep search
  - TypeScript compilation catches missing params
  - Runtime validation

**5. Nested Containers**
- **Risk:** Recursive complexity
- **Mitigation:**
  - Test deeply nested scenarios
  - Verify parent and child both migrated

### LOW Risk

**6. UI Rendering**
- **Risk:** Visual display issues
- **Mitigation:**
  - Already supports grid coordinates
  - Visual regression testing

---

## 8. Testing Strategy

### Unit Tests

**1. Migration Tests**
```typescript
describe("Grid Coordinate Migration", () => {
    test("assigns coordinates based on array index", () => {
        const contents = [{ instance: item1 }, { instance: item2 }];
        ensure_grid_coordinates(contents, 5); // 5 columns
        expect(contents[0].grid_x).toBe(0);
        expect(contents[0].grid_y).toBe(0);
        expect(contents[1].grid_x).toBe(1);
        expect(contents[1].grid_y).toBe(0);
    });
    
    test("preserves existing coordinates", () => {
        const contents = [{ instance: item1, grid_x: 3, grid_y: 2 }];
        ensure_grid_coordinates(contents, 5);
        expect(contents[0].grid_x).toBe(3); // Unchanged
        expect(contents[0].grid_y).toBe(2); // Unchanged
    });
});
```

**2. Transfer Tests**
```typescript
describe("Unified Transfer System", () => {
    test("moves item to target grid position", () => {
        // Setup container with item at (0,0)
        // Transfer to (2,1)
        // Verify item now at (2,1)
    });
    
    test("fails if target position occupied", () => {
        // Setup container with items at (0,0) and (1,0)
        // Try to move item to (1,0)
        // Verify failure
    });
});
```

### Integration Tests

**1. End-to-End Transfers**
- [ ] Drag within same container
- [ ] Drag to different container
- [ ] Equip to body slot
- [ ] Unequip from body slot
- [ ] Stack items
- [ ] Split stacks

**2. Migration Scenarios**
- [ ] Open container with old data (no grid coords)
- [ ] Verify migration happens automatically
- [ ] Save and reload
- [ ] Verify coordinates persisted

**3. Edge Cases**
- [ ] Full container
- [ ] Empty container
- [ ] Single slot container
- [ ] Nested containers
- [ ] Cross-slot-type transfers

### Regression Tests

**1. Visual Regression**
- [ ] Screenshots before/after (should be identical)
- [ ] All items appear at correct positions
- [ ] No visual glitches

**2. Performance**
- [ ] Container opening time
- [ ] Transfer operation time
- [ ] Save/load time

**3. Data Integrity**
- [ ] Item counts match
- [ ] No lost items
- [ ] Coordinates valid (not negative, not out of bounds)

---

## 9. Success Criteria

### Must Have
- [ ] All items have `grid_x` and `grid_y` coordinates
- [ ] No packed array fallback code remains
- [ ] All transfers use unified grid-based logic
- [ ] Migration successfully handles existing data
- [ ] No items lost during transfers
- [ ] Visual positions match stored positions

### Should Have
- [ ] Migration logs for audit trail
- [ ] Performance equal or better than before
- [ ] Comprehensive test coverage
- [ ] Clear documentation for developers

### Nice to Have
- [ ] Migration tool for bulk updates
- [ ] Validation that catches coordinate errors
- [ ] Performance metrics
- [ ] Visual debugging tools

---

## 10. Rollback Plan

**If Critical Issues Found:**

1. **Immediate:** Revert code changes
2. **Data:** Restore from pre-migration backup
3. **Investigation:** Analyze logs to identify issue
4. **Fix:** Address root cause
5. **Retry:** Re-run migration with fixes

**Emergency Switches (if needed):**
- Feature flag to disable grid system
- Keep migration code removable
- Document restore procedure

---

## 11. Post-Implementation

### Cleanup Tasks
- [ ] Remove migration code (once all data migrated)
- [ ] Remove backward compatibility shims
- [ ] Archive old plan documents
- [ ] Update AGENTS.md with final state

### Documentation
- [ ] Update API documentation
- [ ] Document coordinate system for developers
- [ ] Create troubleshooting guide
- [ ] Update related plans

### Monitoring
- [ ] Monitor logs for errors
- [ ] Track migration completion
- [ ] Watch for coordinate-related bugs
- [ ] Collect performance metrics

---

## 12. Debugging & Testing Strategy

### 12.1 Debug Logging Integration

This refactor includes comprehensive debug logging compatible with `npm run dev:logs`. All logs appear in:
```
local_data/data_slot_<N>/logs/YYYY-MM-DD/session_<timestamp>_<id>.log
```

#### Migration Debugging

**Log Prefix:** `[MIGRATION]`

Add to migration function:
```typescript
import { debug_log, debug_warn, debug_error } from '../shared/debug.js';

function ensure_grid_coordinates(
    contents: ContainerContentEntry[],
    container_id: string,
    cols: number
): void {
    let migrated_count = 0;
    
    debug_log("[MIGRATION] Starting migration check for container:", container_id);
    debug_log("[MIGRATION] Container has", contents.length, "items, grid columns:", cols);
    
    contents.forEach((entry, index) => {
        if (entry.grid_x === undefined || entry.grid_y === undefined) {
            const old_grid_x = entry.grid_x;
            const old_grid_y = entry.grid_y;
            
            entry.grid_x = index % cols;
            entry.grid_y = Math.floor(index / cols);
            migrated_count++;
            
            debug_log("[MIGRATION] Assigned coordinates to item", entry.instance.def_id, 
                "at index", index, "-> grid(" + entry.grid_x + "," + entry.grid_y + ")");
            
            if (old_grid_x !== undefined || old_grid_y !== undefined) {
                debug_warn("[MIGRATION] Item had partial coordinates:", 
                    "grid_x=" + old_grid_x, "grid_y=" + old_grid_y);
            }
        }
    });
    
    if (migrated_count > 0) {
        debug_log("[MIGRATION] Migrated", migrated_count, "items in container", container_id);
    } else {
        debug_log("[MIGRATION] All items already have coordinates in container", container_id);
    }
}
```

**What to look for in logs:**
- `[MIGRATION] Starting migration check...` - Container opened, checking items
- `[MIGRATION] Assigned coordinates...` - Item migrated from packed to grid
- `[MIGRATION] Migrated X items...` - Summary for container
- `[MIGRATION] All items already have coordinates...` - No migration needed

#### Transfer Debugging

**Log Prefix:** `[UNIFIED-TRANSFER]`

Add to transfer function:
```typescript
export function transfer_item_between_containers(
    // ... parameters (grid_x and grid_y now required)
): { ok: boolean; error?: string } {
    debug_log("[UNIFIED-TRANSFER] === START ===");
    debug_log("[UNIFIED-TRANSFER] Transferring:", item_instance_id);
    debug_log("[UNIFIED-TRANSFER] From:", from_container_id, "To:", to_container_id);
    debug_log("[UNIFIED-TRANSFER] Target position: grid(" + target_grid_x + "," + target_grid_y + ")");
    
    // ... validation and lookup ...
    
    if (!item_entry) {
        debug_error("[UNIFIED-TRANSFER] FAILED: Item not found in source container");
        return { ok: false, error: "item_not_found" };
    }
    
    debug_log("[UNIFIED-TRANSFER] Found item:", item_entry.instance.def_id, 
        "at grid(" + item_entry.grid_x + "," + item_entry.grid_y + ")");
    
    // Check target position
    const existing_item = dest_contents.find(e => 
        e.grid_x === target_grid_x && e.grid_y === target_grid_y
    );
    
    if (existing_item) {
        debug_warn("[UNIFIED-TRANSFER] Target position occupied by:", existing_item.instance.def_id);
        // ... handle stacking or blocking ...
    }
    
    // ... perform transfer ...
    
    debug_log("[UNIFIED-TRANSFER] Moving item to grid(" + target_grid_x + "," + target_grid_y + ")");
    
    item_entry.grid_x = target_grid_x;
    item_entry.grid_y = target_grid_y;
    
    debug_log("[UNIFIED-TRANSFER] === SUCCESS ===");
    debug_log("[UNIFIED-TRANSFER] Item now at grid(" + item_entry.grid_x + "," + item_entry.grid_y + ")");
    
    return { ok: true };
}
```

**What to look for in logs:**
- `[UNIFIED-TRANSFER] === START ===` - Transfer initiated
- `[UNIFIED-TRANSFER] Target position: grid(X,Y)` - Where item is going
- `[UNIFIED-TRANSFER] Target position occupied...` - Slot already has item
- `[UNIFIED-TRANSFER] === SUCCESS ===` - Transfer completed
- `[UNIFIED-TRANSFER] FAILED: ...` - Error details

#### Item Creation Debugging

**Log Prefix:** `[ITEM-CREATE]`

```typescript
export function create_inline_item(
    // ... parameters including grid_x, grid_y
): ItemInstance {
    debug_log("[ITEM-CREATE] Creating item:", def_id);
    debug_log("[ITEM-CREATE] At grid position: (" + grid_x + "," + grid_y + ")");
    debug_log("[ITEM-CREATE] In container:", container_id);
    
    // ... create item ...
    
    debug_log("[ITEM-CREATE] SUCCESS: Item", instance.id, "created");
    
    return instance;
}
```

### 12.2 Testing Checklist

Use these checks while running `npm run dev:logs`:

#### Phase 1 Testing
- [ ] Open container → Check logs for `[MIGRATION]` entries
- [ ] Verify existing items get coordinates assigned
- [ ] Close and reopen container → Should see "All items already have coordinates"
- [ ] Check no errors in migration logs

#### Phase 2 Testing
- [ ] Create new item → Check `[ITEM-CREATE]` log shows grid coordinates
- [ ] Verify item appears at correct position
- [ ] Check no "undefined" coordinates in logs

#### Phase 3 Testing
- [ ] Drag item within container → Check `[UNIFIED-TRANSFER]` logs
- [ ] Verify grid coordinates updated
- [ ] Cross-container transfer → Check coordinates preserved/assigned
- [ ] Body slot transfer → Check works correctly

#### Regression Testing
- [ ] All existing tests pass
- [ ] No `[ERROR]` entries in logs
- [ ] No unexpected `[WARN]` entries
- [ ] Performance comparable to before

### 12.3 Log Analysis Commands

**Watch migration in real-time:**
```bash
# In terminal while running npm run dev:logs
tail -f local_data/data_slot_1/logs/$(date +%Y-%m-%d)/session_*.log | grep "MIGRATION"
```

**Find all transfer operations:**
```bash
grep "UNIFIED-TRANSFER" local_data/data_slot_1/logs/$(date +%Y-%m-%d)/session_*.log
```

**Check for errors:**
```bash
grep -i "error\|failed" local_data/data_slot_1/logs/$(date +%Y-%m-%d)/session_*.log | grep -E "(MIGRATION|UNIFIED-TRANSFER|ITEM-CREATE)"
```

**View migration summary:**
```bash
grep "MIGRATION.*Migrated" local_data/data_slot_1/logs/$(date +%Y-%m-%d)/session_*.log
```

### 12.4 Debug Mode Toggle

Add to config for verbose debugging:
```typescript
// src/config.ts
export const CONFIG = {
    // ... existing config ...
    DEBUG_MIGRATION: true,      // Log all migration operations
    DEBUG_TRANSFERS: true,      // Log all transfers
    DEBUG_ITEM_CREATION: true,  // Log item creation
};
```

Then wrap debug logs:
```typescript
if (CONFIG.DEBUG_MIGRATION) {
    debug_log("[MIGRATION] ...");
}
```

### 12.5 Troubleshooting Common Issues

**Issue: Items not getting coordinates**
- Check logs for `[MIGRATION]` entries
- Verify `ensure_grid_coordinates()` is called on container load
- Check `grid_calculator.ts` returns valid cols value

**Issue: Transfers failing**
- Check `[UNIFIED-TRANSFER]` logs for specific error
- Verify `target_grid_x` and `target_grid_y` are being sent
- Check if target position is occupied

**Issue: Items appearing in wrong positions**
- Check migration assigned correct coordinates
- Verify `cols` calculation matches visual grid
- Check transfer updated coordinates correctly

**Issue: Performance degradation**
- Check migration isn't running repeatedly
- Verify no excessive logging in production
- Profile container loading time

---

## 13. Appendix

### Coordinate System Reference

**Canvas Coordinates (UI):**
- Origin: Bottom-left (0,0)
- X: Increases right
- Y: Increases up
- Used for: All UI rendering, mouse events, hit detection

**Grid Coordinates (Storage):**
- Origin: Conceptually top-left (0,0)
- X: Column (increases right)
- Y: Row (increases down)
- Used for: Item positioning within containers

**Conversion:**
```typescript
// Slot index (linear array position) to Grid
grid_x = slot_index % cols;
grid_y = Math.floor(slot_index / cols);

// Grid to Slot Index
slot_index = grid_y * cols + grid_x;
```

### API Reference

**Unified Transfer API:**
```typescript
POST /api/transfer
{
    "item_instance_id": "string",
    "from_container": "string",
    "to_container": "string",
    "target_grid_x": number,      // REQUIRED
    "target_grid_y": number       // REQUIRED
}
```

### Migration Example

**Before Migration:**
```json
{
    "contents": [
        {"instance": {...}},  // No grid_x/y
        {"instance": {...}}   // No grid_x/y
    ]
}
```

**After Migration (5-column container):**
```json
{
    "contents": [
        {"instance": {...}, "grid_x": 0, "grid_y": 0},
        {"instance": {...}, "grid_x": 1, "grid_y": 0}
    ]
}
```

---

**Status:** Ready for Implementation  
**Next Step:** Begin Phase 1 - Foundation  
**Assigned To:** TBD  
**Start Date:** TBD  
**Estimated Completion:** 2-3 Days

---

*This plan represents a comprehensive refactor to unify the item storage system under a single grid coordinate format. All items will have explicit grid_x and grid_y coordinates, eliminating dual-path logic and ensuring consistent behavior across all containers.*
