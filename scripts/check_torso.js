// Script to check torso slot and tunic compatibility
import fs from 'fs';

const actorContent = fs.readFileSync('local_data/data_slot_1/actors/henry_actor.jsonc', 'utf8');
const actorData = JSON.parse(actorContent);

console.log('=== BODY SLOTS ===');
console.log('Torso slot:', actorData.body_slots.torso);

// Check where the torso container is
console.log('\n=== AVAILABLE CONTAINERS ===');
console.log(Object.keys(actorData.containers));

console.log('\n=== TORSO CONTAINER ===');
if (actorData.containers.torso) {
    console.log('Container ID:', actorData.containers.torso.id);
    console.log('Contents count:', actorData.containers.torso.contents?.length || 0);
} else {
    console.log('No torso container found in data.containers');
}

const tunicContent = fs.readFileSync('local_data/data_slot_1/items/tunic.jsonc', 'utf8');
const tunicData = JSON.parse(tunicContent);

console.log('\n=== TUNIC DEFINITION ===');
console.log('valid_body_slots:', tunicData.valid_body_slots);
console.log('occupies_slots:', tunicData.occupies_slots);

// Check if torso is a body slot container
console.log('\n=== CHECKS ===');
console.log('Is torso in valid_body_slots?', tunicData.valid_body_slots.includes('torso'));
console.log('Torso slot occupied?', actorData.body_slots.torso.item_instance_id !== null);
console.log('Torso slot item:', actorData.body_slots.torso.item_instance_id);

// Check leg_right sack contents
console.log('\n=== LEG_RIGHT SACK CONTENTS ===');
if (actorData.containers.leg_right?.contents?.[0]?.instance?.container_data?.contents) {
    const sackContents = actorData.containers.leg_right.contents[0].instance.container_data.contents;
    console.log('Sack has', sackContents.length, 'items:');
    sackContents.forEach((item, i) => {
        console.log(`  ${i}: ${item.instance?.id} - ${item.instance?.def_id}`);
    });
}
