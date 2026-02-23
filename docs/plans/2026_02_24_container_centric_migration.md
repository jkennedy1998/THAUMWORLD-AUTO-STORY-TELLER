# Container-Centric Storage Implementation Plan

**Status:** Planning  
**Goal:** Migrate from separate item_instance/container files to entity-centric embedded storage  
**Motivation:** Simplify architecture, improve scalability, enable nested containers

---

## 1. Current State Analysis

### Data Model (Current)

```
File Structure:
local_data/data_slot_1/
├── npcs/
│   └── gunther.jsonc              (NPC data with body_slots referencing items)
├── item_instances/
│   ├── inst_xxx.jsonc             (44 separate item files)
│   └── ...
├── containers/
│   ├── container.gunther.leg_left.jsonc  (9 separate container files)
│   └── ...
└── items/
    └── small_sack.jsonc           (Item definitions)
```

### Performance Issues

**Problem: O(n) container lookups**
```typescript
// Current - must scan ALL item files
function list_items_in_container(container_id: string) {
    const files = fs.readdirSync(item_instances_dir);  // 1000+ files
    for (const file of files) {                        // O(n)
        const item = load_item(file);
        if (item.container_id === container_id) {      // Filter
            results.push(item);
        }
    }
}
```

**With 1000 items:** 1000 file reads to find items in one container
**With 10000 items:** 10000 file reads

### Consistency Risks

- Item file exists but container doesn't reference it (orphan)
- Container references item that doesn't exist (dangling pointer)
- Item moved but old container still references it (duplicate)
- Crash during transfer = partial update

---

## 2. Target Architecture

### Entity-Centric Model

```
File Structure:
local_data/data_slot_1/
├── npcs/
│   └── gunther.jsonc              (NPC + containers + items inline)
├── places/
│   └── eden_crossroads.jsonc      (Place + ground container + items inline)
└── items/
    └── small_sack.jsonc           (Item definitions only)
```

### Data Structure

```typescript
// NPC/Place file structure
interface Entity {
    id: string;
    name: string;
    // ... other entity fields ...
    
    containers: {
        [container_name: string]: ContainerData;
    };
}

interface ContainerData {
    max_slots: number;
    max_weight?: number;
    contents: ItemInstanceData[];  // Items stored inline
}

interface ItemInstanceData {
    instance_id: string;           // Unique instance ID
    def_id: string;                // Reference to item definition
    qty: number;
    condition?: string;
    tags: TagInstance[];
    
    // Nested container support
    internal_container_name?: string;  // If item IS a container, points to sub-container
}
```

### Example: Gunther with Nested Sack

```jsonc
{
    "id": "gunther",
    "name": "Gunther the Woodcarver",
    "containers": {
        // Body slot containers
        "leg_left": {
            "max_slots": 1,
            "contents": [
                {
                    "instance_id": "inst_sack_001",
                    "def_id": "small_sack",
                    "qty": 1,
                    "condition": "good",
                    "tags": [],
                    "internal_container_name": "sack_001_contents"  // Nested!
                }
            ]
        },
        "hand_right": {
            "max_slots": 1,
            "contents": [
                {
                    "instance_id": "inst_knife_001",
                    "def_id": "whittling_knife",
                    "qty": 1,
                    "tags": []
                }
            ]
        },
        
        // Nested container (the sack's contents)
        "sack_001_contents": {
            "max_slots": 6,
            "contents": [
                {
                    "instance_id": "inst_coin_001",
                    "def_id": "copper_coin",
                    "qty": 50,
                    "tags": []
                },
                {
                    "instance_id": "inst_carving_001",
                    "def_id": "wooden_soldier",
                    "qty": 1,
                    "tags": []
                }
            ]
        }
    }
}
```

---

## 3. Implementation Phases

### Phase 1: Data Structure Updates (Week 1)

**Files to Modify:**
- `src/types/container.ts` - Update Container interface
- `src/types/item.ts` - Create ItemInstanceData interface
- `src/container_storage/store.ts` - Refactor for inline storage

**Changes:**

1. **Remove separate container files**
   - Delete `local_data/data_slot_1/containers/` directory
   - Remove container file I/O functions

2. **Add containers field to NPC/Place types**
   ```typescript
   interface NPC {
       id: string;
       name: string;
       // ... existing fields ...
       containers: Record<string, ContainerData>;
   }
   ```

3. **Update Container interface**
   ```typescript
   interface ContainerData {
       max_slots: number;
       max_weight?: number;
       contents: ItemInstanceData[];  // Inline, not references
   }
   ```

**Acceptance:**
- [ ] Container interface supports inline items
- [ ] NPC interface has containers field
- [ ] Place interface has containers field

---

### Phase 2: Storage Layer Refactor (Week 1-2)

**Files to Modify:**
- `src/npc_storage/store.ts` - Load/save containers with NPC
- `src/place_storage/store.ts` - Load/save containers with place
- `src/item_instances/store.ts` - Remove file-based storage, keep as utility
- `src/container_storage/store.ts` - Remove file I/O, keep as utility

**Changes:**

1. **Update NPC save/load**
   ```typescript
   // When saving NPC
   function save_npc(slot: number, npc: NPC): void {
       // NPC already includes containers inline
       fs.writeFileSync(get_npc_path(slot, npc.id), JSON.stringify(npc, null, 2));
   }
   
   // When loading NPC
   function load_npc(slot: number, npc_id: string): NPC {
       const data = read_jsonc(get_npc_path(slot, npc_id));
       return data as NPC;  // Containers included
   }
   ```

2. **Simplify item operations**
   ```typescript
   // Find item in NPC's containers
   function find_item_in_npc(npc: NPC, instance_id: string): {
       container_name: string;
       item: ItemInstanceData;
       index: number;
   } | null {
       for (const [container_name, container] of Object.entries(npc.containers)) {
           const index = container.contents.findIndex(i => i.instance_id === instance_id);
           if (index !== -1) {
               return { container_name, item: container.contents[index], index };
           }
       }
       return null;
   }
   ```

3. **Transfer operation**
   ```typescript
   function transfer_item(
       from_npc: NPC,
       from_container: string,
       to_npc: NPC,
       to_container: string,
       item_index: number
   ): boolean {
       // 1. Remove from source (in-memory array operation)
       const [item] = from_npc.containers[from_container].contents.splice(item_index, 1);
       
       // 2. Add to destination (in-memory array operation)
       to_npc.containers[to_container].contents.push(item);
       
       // 3. Save both NPCs (atomic per entity)
       save_npc(slot, from_npc);
       save_npc(slot, to_npc);
       
       return true;
   }
   ```

**Acceptance:**
- [ ] NPC save/load includes containers
- [ ] Place save/load includes containers
- [ ] Item operations work on in-memory data
- [ ] No more item_instance directory
- [ ] No more container directory

---

### Phase 3: Data Migration (Week 2)

**Script:** `src/tools/migrate_to_inline_storage.ts`

**Steps:**

1. **Load existing data**
   ```typescript
   // Load all NPCs
   const npcs = load_all_npcs();
   
   // Load all item instances
   const items = load_all_item_instances();
   
   // Load all containers
   const containers = load_all_containers();
   ```

2. **Build entity-centric structure**
   ```typescript
   for (const npc of npcs) {
       // Initialize containers field
       npc.containers = {};
       
       // Get containers owned by this NPC
       const npc_containers = containers.filter(c => c.owner_ref === `npc.${npc.id}`);
       
       for (const container of npc_containers) {
           // Convert container to inline format
           const container_name = container.id.split('.').pop();  // "leg_left"
           
           npc.containers[container_name] = {
               max_slots: container.capacity?.max_slots ?? 10,
               max_weight: container.capacity?.max_weight,
               contents: container.contents.map(entry => {
                   // Find item instance
                   const item = items.find(i => i.id === entry.item_instance_id);
                   return {
                       instance_id: item.id,
                       def_id: item.def_id,
                       qty: item.qty,
                       condition: item.condition,
                       tags: item.tags
                   };
               })
           };
       }
       
       // Save updated NPC
       save_npc(npc);
   }
   ```

3. **Migrate places similarly**
   - Ground containers become place.containers.ground
   - Scattered containers become place.containers.scattered_* entries

4. **Validation**
   - Verify all items migrated
   - Check no orphaned data
   - Test transfer operations

**Acceptance:**
- [ ] All NPCs migrated with inline containers
- [ ] All places migrated with inline containers
- [ ] Item count matches before/after
- [ ] Sample transfers work correctly

---

### Phase 4: Nested Container Support (Week 3)

**Goal:** Enable containers-within-containers (e.g., sack inside backpack)

**Implementation:**

1. **Auto-create internal containers for container-items**
   ```typescript
   function create_item_instance(
       npc: NPC,
       container_name: string,
       def_id: string
   ): ItemInstanceData {
       const item_def = load_item_definition(def_id);
       const instance_id = generate_instance_id();
       
       const item: ItemInstanceData = {
           instance_id,
           def_id,
           qty: 1,
           tags: []
       };
       
       // If item is a container, create internal container
       if (item_def.tags?.some(t => t.name === 'CONTAINER')) {
           const internal_name = `${instance_id}_contents`;
           item.internal_container_name = internal_name;
           
           // Create the internal container
           npc.containers[internal_name] = {
               max_slots: item_def.container?.capacity_slots ?? 5,
               max_weight: item_def.container?.capacity_weight,
               contents: []
           };
       }
       
       // Add to parent container
       npc.containers[container_name].contents.push(item);
       
       return item;
   }
   ```

2. **Open container UI for nested containers**
   ```typescript
   // When right-clicking equipped container item
   function get_container_to_open(npc: NPC, item: ItemInstanceData): ContainerData | null {
       if (item.internal_container_name) {
           return npc.containers[item.internal_container_name];
       }
       return null;
   }
   ```

3. **Transfer to nested container**
   ```typescript
   // Drag item from inventory to open sack
   // Just use the nested container name
   transfer_item(
       npc,
       'backpack_contents',      // From backpack
       npc,
       'inst_sack_001_contents', // To sack inside backpack
       item_index
   );
   ```

**Acceptance:**
- [ ] Container items auto-create internal containers
- [ ] Can open nested containers via right-click
- [ ] Items can be transferred to nested containers
- [ ] Deep nesting works (bag in sack in backpack)

---

### Phase 5: API Updates (Week 3-4)

**Files:** `src/interface_program/main.ts`, `src/canvas_app/app_state.ts`

**Changes:**

1. **Update /api/container endpoint**
   - Return inline container data from NPC/Place
   - No separate container lookups needed

2. **Update /api/transfer endpoint**
   - Work with in-memory NPC data
   - Simpler implementation

3. **Update frontend state management**
   - Load NPCs with all their items
   - No separate item refresh needed
   - UI has complete entity state

**Acceptance:**
- [ ] All API endpoints work with inline storage
- [ ] Frontend loads complete entity data
- [ ] UI updates reflect in-memory changes

---

## 4. Performance Analysis

### Current System (Separate Files)

| Operation | Items | Time | Notes |
|-----------|-------|------|-------|
| Load Gunther's items | 10 | 1000ms | Must scan all 1000 item files |
| Transfer item | 2 | 50ms | Two file writes |
| Find item X | 1000 | 2000ms | Scan all files, check IDs |
| List all containers | 10 | 110ms | 10 container file reads |

### New System (Inline)

| Operation | Items | Time | Notes |
|-----------|-------|------|-------|
| Load Gunther's items | 10 | 10ms | Single file read |
| Transfer item | 2 | 25ms | One file write (NPC) |
| Find item X | 10 | 0.1ms | Array lookup in memory |
| List all containers | 3 | 0.1ms | Object.keys() |

**Performance improvement: 100x faster for most operations**

---

## 5. Data Integrity Improvements

### Before (Reference-Based)

```
Risk: Orphaned items
- Item file exists
- Container doesn't reference it
- Item invisible in game but takes up disk space

Risk: Dangling references
- Container references item
- Item file deleted
- Access = crash or error

Risk: Partial transfers
- Crash between remove-from-A and add-to-B
- Item lost in void
```

### After (Inline)

```
Solution: No orphans
- Items only exist within containers
- Delete container = delete all items
- No hidden items

Solution: No dangling refs
- No references to external files
- All data in one place
- Atomic per entity

Solution: Simpler transactions
- Transfer = memory operation + one save
- Entity-level atomicity
- Easier to reason about
```

---

## 6. Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Large NPC files** | Medium | Most NPCs have <20 items = small files. Bosses with 100+ items = acceptable 100KB files |
| **Concurrent access** | Medium | File locking or atomic writes. Tabletop = usually single-user |
| **Data corruption** | Low | JSON is human-readable/repairable. Backup before migration |
| **Rollback needed** | Low | Keep migration script. Can restore from backup |
| **Performance regression** | Very Low | 100x improvement expected. Monitor save times |

---

## 7. Testing Strategy

### Unit Tests

```typescript
// Test: Transfer item between NPCs
test('transfer item from Gunther to Henry', () => {
    const gunther = load_npc('gunther');
    const henry = load_npc('henry');
    
    const result = transfer_item(
        gunther, 'hand_right',  // From Gunther's hand
        henry, 'leg_left',      // To Henry's leg
        0                       // First item
    );
    
    expect(result).toBe(true);
    expect(gunther.containers.hand_right.contents).toHaveLength(0);
    expect(henry.containers.leg_left.contents).toHaveLength(1);
});

// Test: Nested container creation
test('create container item creates internal container', () => {
    const npc = create_test_npc();
    
    const sack = create_item_instance(npc, 'leg_left', 'small_sack');
    
    expect(sack.internal_container_name).toBeDefined();
    expect(npc.containers[sack.internal_container_name]).toBeDefined();
    expect(npc.containers[sack.internal_container_name].max_slots).toBe(6);
});
```

### Integration Tests

1. **Migration test**
   - Run migration on full dataset
   - Verify item counts match
   - Test sample transfers

2. **Nested container test**
   - Create bag in sack in backpack
   - Transfer items through multiple levels
   - Verify no data loss

3. **Save/load test**
   - Create complex NPC with nested items
   - Save and reload
   - Verify structure intact

---

## 8. Rollback Plan

If issues arise:

1. **Keep backups**
   - Backup entire `local_data/` before migration
   - Version control the migration script

2. **Migration is idempotent**
   - Can run multiple times safely
   - Detects already-migrated data

3. **Emergency restore**
   ```bash
   # If critical bug found
   rm -rf local_data/data_slot_1/
   cp -r local_data/data_slot_1_backup/ local_data/data_slot_1/
   ```

---

## 9. Success Criteria

**Phase Complete When:**
- [ ] All existing data migrated successfully
- [ ] No data loss (item count matches)
- [ ] All existing functionality works
- [ ] Nested containers functional
- [ ] Performance improved 10x+
- [ ] Code complexity reduced
- [ ] Developer happiness increased

---

## 10. Open Questions

1. **Body slots representation**
   - Should body slots be implicit containers or explicit?
   - Current: `containers.leg_left` exists for every slot
   - Alternative: `body_slots.leg_left = { item, container_name }`

2. **Place ground containers**
   - Single ground container per place?
   - Or support multiple scattered piles?
   - Current plan: `containers.ground` for main, `containers.scattered_x_y` for piles

3. **Item instance IDs**
   - Keep random IDs (inst_xxx)?
   - Or use sequential (item_001)?
   - Or deterministic (gunther_sack_001)?

4. **Migration timing**
   - One-time migration script?
   - Or lazy migration on first access?
   - Current plan: One-time full migration

---

## Next Steps

1. **Review this plan** - Identify issues, omissions, concerns
2. **Answer open questions** - Make architectural decisions
3. **Estimate timeline** - Confirm 4-week estimate
4. **Begin Phase 1** - Start implementation

**Questions for you:**
- Any concerns with this approach?
- Preferences for the open questions?
- Timeline constraints?
- Should we proceed or refine further?
