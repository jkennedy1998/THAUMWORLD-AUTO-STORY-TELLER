// Comprehensive fix for actor body slot containers
import fs from 'fs';

const actorPath = 'local_data/data_slot_1/actors/henry_actor.jsonc';
let content = fs.readFileSync(actorPath, 'utf8');
let actor = JSON.parse(content);

console.log('=== COMPREHENSIVE BODY SLOT FIX ===\n');

// Load item definitions
function loadItemDef(defId) {
    try {
        const defContent = fs.readFileSync(`local_data/data_slot_1/items/${defId}.jsonc`, 'utf8');
        return JSON.parse(defContent);
    } catch (e) {
        console.log(`Warning: Could not load ${defId}.jsonc`);
        return null;
    }
}

// Helper to create item entry
function createItemEntry(instanceId, defId, def, slotName) {
    return {
        instance: {
            id: instanceId,
            def_id: defId,
            qty: 1,
            condition: "good",
            tags: def.tags || [],
            container_id: `container.henry_actor.${slotName}`,
            owner_ref: "actor.henry_actor"
        },
        definition: def,
        grid_x: 0,
        grid_y: 0
    };
}

// Helper to create container
function createContainer(slotName, itemEntry = null) {
    const container = {
        id: `container.henry_actor.${slotName}`,
        kind: "actor",
        owner_ref: "actor.henry_actor",
        controller_ref: "actor.henry_actor",
        capacity: {
            max_slots: 1,
            max_weight: 5000
        },
        contents: itemEntry ? [itemEntry] : [],
        tags: [],
        interaction_range: 1,
        is_open: false,
        is_locked: false
    };
    return container;
}

// Step 1: Clean up containers structure
console.log('Step 1: Cleaning containers structure...');
const validContainerNames = ['hand_left', 'hand_right', 'head', 'torso', 'leg_left', 'leg_right'];
const cleanContainers = {};

for (const name of validContainerNames) {
    // Check if container exists in various locations
    let container = null;
    
    if (actor.containers && actor.containers[name] && !['contents', 'tags', 'interaction_range', 'is_open', 'is_locked'].includes(name)) {
        // It's in containers object and is a real container
        container = actor.containers[name];
    } else if (actor[name] && actor[name].id && actor[name].id.includes('container.')) {
        // It's at root level
        container = actor[name];
        // Remove from root
        delete actor[name];
    }
    
    if (container) {
        cleanContainers[name] = container;
    }
}

actor.containers = cleanContainers;
console.log(`  Found ${Object.keys(cleanContainers).length} containers`);

// Step 2: Fix each body slot
console.log('\nStep 2: Fixing body slots...');

const bodySlots = actor.body_slots || {};

// Fix torso
if (bodySlots.torso && bodySlots.torso.item_instance_id) {
    const tunicDef = loadItemDef('tunic');
    if (tunicDef) {
        const tunicEntry = createItemEntry('inst_tunic_test_001', 'tunic', tunicDef, 'torso');
        actor.containers.torso = createContainer('torso', tunicEntry);
        console.log('  ✓ Fixed torso: Added tunic');
    }
}

// Fix hand_left - should have sword
if (bodySlots.hand_left && bodySlots.hand_left.item_instance_id) {
    // Check if sword def exists, if not create a basic one
    let swordDef = loadItemDef('sword');
    if (!swordDef) {
        // Use dagger as base for now
        swordDef = loadItemDef('iron_dagger');
        if (swordDef) {
            swordDef = {...swordDef};
            swordDef.id = 'sword';
            swordDef.name = 'Sword';
            swordDef.description = 'A basic iron sword.';
            swordDef.weight = 2.5;
            swordDef.display_char = '/';
        }
    }
    
    if (swordDef) {
        const swordEntry = createItemEntry('inst_sword_test_001', 'sword', swordDef, 'hand_left');
        actor.containers.hand_left = createContainer('hand_left', swordEntry);
        console.log('  ✓ Fixed hand_left: Added sword');
    }
}

// Fix hand_right - should have torch
if (bodySlots.hand_right && bodySlots.hand_right.item_instance_id) {
    let torchDef = loadItemDef('torch');
    if (!torchDef) {
        // Create basic torch def
        torchDef = {
            id: 'torch',
            name: 'Torch',
            description: 'A wooden torch for lighting.',
            weight: 0.5,
            weight_mag: 1,
            mag: 1,
            size_mag: 2,
            hardness_mag: 1,
            conductivity_mag: 1,
            tags: [{ name: 'TOOL', mag: 1, meta: [] }],
            stackable: false,
            max_stack_size: 1,
            display_char: 'i',
            valid_body_slots: ['hand_left', 'hand_right'],
            occupies_slots: ['hand_right'],
            slot_shape: [[1]],
            fits_actor_kind: ['*']
        };
    }
    
    const torchEntry = createItemEntry('inst_torch_test_001', 'torch', torchDef, 'hand_right');
    actor.containers.hand_right = createContainer('hand_right', torchEntry);
    console.log('  ✓ Fixed hand_right: Added torch');
}

// Fix leg_left - should have pants
if (bodySlots.leg_left && bodySlots.leg_left.item_instance_id) {
    const pantsDef = loadItemDef('pants');
    if (pantsDef) {
        const pantsEntry = createItemEntry('inst_pants_unique_001', 'pants', pantsDef, 'leg_left');
        actor.containers.leg_left = createContainer('leg_left', pantsEntry);
        console.log('  ✓ Fixed leg_left: Added pants');
    }
}

// Fix leg_right - empty but ensure container exists
if (!actor.containers.leg_right) {
    actor.containers.leg_right = createContainer('leg_right');
    console.log('  ✓ Fixed leg_right: Created empty container');
}

// Step 3: Save
fs.writeFileSync(actorPath, JSON.stringify(actor, null, 2));

console.log('\n=== VERIFICATION ===');
for (const [slotName, slotData] of Object.entries(actor.body_slots)) {
    const itemId = slotData.item_instance_id;
    if (itemId) {
        const container = actor.containers[slotName];
        if (container && container.contents && container.contents.length > 0) {
            const containerItem = container.contents[0].instance.id;
            const match = containerItem === itemId ? '✓' : '✗';
            console.log(`${slotName}: ${match} ${itemId} === ${containerItem}`);
        } else {
            console.log(`${slotName}: ✗ Container empty or missing!`);
        }
    } else {
        console.log(`${slotName}: (empty)`);
    }
}

console.log('\n=== FIX COMPLETE ===');
