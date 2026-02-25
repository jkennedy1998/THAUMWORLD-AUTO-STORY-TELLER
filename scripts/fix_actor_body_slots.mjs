// Fix body slot containers for henry_actor
import fs from 'fs';

const actorPath = 'local_data/data_slot_1/actors/henry_actor.jsonc';
const actor = JSON.parse(fs.readFileSync(actorPath, 'utf8'));

console.log('Fixing body slot containers...\n');

// Load item definitions
function loadItemDef(defId) {
    const defPath = `local_data/data_slot_1/items/${defId}.jsonc`;
    if (fs.existsSync(defPath)) {
        const content = fs.readFileSync(defPath, 'utf8');
        return JSON.parse(content);
    }
    return null;
}

const tunicDef = loadItemDef('tunic');
const swordDef = loadItemDef('sword');
const torchDef = loadItemDef('torch');
const pantsDef = loadItemDef('pants');

// Helper to create item entry
function createItemEntry(instanceId, defId, def, slotName) {
    return {
        instance: {
            id: instanceId,
            def_id: defId,
            qty: 1,
            condition: "good",
            tags: [],
            container_id: `container.henry_actor.${slotName}`,
            owner_ref: "actor.henry_actor"
        },
        definition: def,
        grid_x: 0,
        grid_y: 0
    };
}

// 1. Fix torso - add tunic
if (actor.containers.torso && actor.containers.torso.contents.length === 0) {
    console.log('Adding tunic to torso container...');
    actor.containers.torso.contents.push(createItemEntry('inst_tunic_test_001', 'tunic', tunicDef, 'torso'));
}

// 2. Fix hand_left - replace dagger with sword
if (actor.containers.hand_left && swordDef) {
    console.log('Replacing dagger with sword in hand_left...');
    actor.containers.hand_left.contents = [createItemEntry('inst_sword_test_001', 'sword', swordDef, 'hand_left')];
}

// 3. Fix hand_right - add torch
if (actor.containers.hand_right && torchDef) {
    console.log('Adding torch to hand_right container...');
    actor.containers.hand_right.contents = [createItemEntry('inst_torch_test_001', 'torch', torchDef, 'hand_right')];
}

// 4. Fix leg_left - replace shoes with pants
if (actor.containers.leg_left && pantsDef) {
    console.log('Replacing shoes with pants in leg_left...');
    // Keep the sack if it exists
    const sack = actor.containers.leg_left.contents.find(c => c.instance.def_id === 'small_sack');
    const pantsEntry = createItemEntry('inst_pants_unique_001', 'pants', pantsDef, 'leg_left');
    
    if (sack) {
        actor.containers.leg_left.contents = [pantsEntry, sack];
    } else {
        actor.containers.leg_left.contents = [pantsEntry];
    }
}

// Save the fixed actor file
fs.writeFileSync(actorPath, JSON.stringify(actor, null, 2));
console.log('\nFixed henry_actor body slot containers!');

// Verify
console.log('\n=== Verification ===');
for (const [slotName, slotData] of Object.entries(actor.body_slots)) {
    const itemId = slotData.item_instance_id;
    if (itemId) {
        const container = actor.containers[slotName];
        if (container && container.contents.length > 0) {
            const containerItem = container.contents[0].instance.id;
            const match = containerItem === itemId ? '✓' : '✗';
            console.log(`${slotName}: ${match} ${itemId} === ${containerItem}`);
        } else {
            console.log(`${slotName}: ✗ Container empty!`);
        }
    } else {
        console.log(`${slotName}: (empty)`);
    }
}
