import * as fs from "node:fs";
import * as path from "node:path";

const slot = 1;
const baseDir = `local_data/data_slot_${slot}`;

console.log("Wiping items from actors, NPCs, and places...\n");

// Wipe actor items
const actorDir = path.join(baseDir, "actors");
if (fs.existsSync(actorDir)) {
  const actors = fs.readdirSync(actorDir).filter(f => f.endsWith(".jsonc"));
  for (const actorFile of actors) {
    const actorPath = path.join(actorDir, actorFile);
    try {
      const content = fs.readFileSync(actorPath, "utf-8");
      const actor = JSON.parse(content);
      let modified = false;
      
      if (actor.body_slots) {
        for (const slotName of Object.keys(actor.body_slots)) {
          if (actor.body_slots[slotName]?.item) {
            actor.body_slots[slotName].item = null;
            modified = true;
          }
        }
      }
      
      if (actor.containers) {
        for (const containerId of Object.keys(actor.containers)) {
          actor.containers[containerId].contents = [];
          modified = true;
        }
      }
      
      if (modified) {
        fs.writeFileSync(actorPath, JSON.stringify(actor, null, 2));
        console.log(`✓ Cleared items from actor: ${actorFile}`);
      }
    } catch (err) {
      console.error(`✗ Failed to process actor ${actorFile}:`, err);
    }
  }
}

// Wipe NPC items
const npcDir = path.join(baseDir, "npcs");
if (fs.existsSync(npcDir)) {
  const npcs = fs.readdirSync(npcDir).filter(f => f.endsWith(".jsonc"));
  for (const npcFile of npcs) {
    const npcPath = path.join(npcDir, npcFile);
    try {
      const content = fs.readFileSync(npcPath, "utf-8");
      const npc = JSON.parse(content);
      let modified = false;
      
      if (npc.body_slots) {
        for (const slotName of Object.keys(npc.body_slots)) {
          if (npc.body_slots[slotName]?.item) {
            npc.body_slots[slotName].item = null;
            modified = true;
          }
        }
      }
      
      if (npc.containers) {
        for (const containerId of Object.keys(npc.containers)) {
          npc.containers[containerId].contents = [];
          modified = true;
        }
      }
      
      if (modified) {
        fs.writeFileSync(npcPath, JSON.stringify(npc, null, 2));
        console.log(`✓ Cleared items from NPC: ${npcFile}`);
      }
    } catch (err) {
      console.error(`✗ Failed to process NPC ${npcFile}:`, err);
    }
  }
}

// Wipe place items
const placesDir = path.join(baseDir, "world", "places");
if (fs.existsSync(placesDir)) {
  const places = fs.readdirSync(placesDir).filter(f => f.endsWith(".jsonc"));
  for (const placeFile of places) {
    const placePath = path.join(placesDir, placeFile);
    try {
      const content = fs.readFileSync(placePath, "utf-8");
      const place = JSON.parse(content);
      let modified = false;
      
      if (place.ground?.main?.length > 0) {
        place.ground.main = [];
        modified = true;
      }
      
      if (place.ground?.scattered) {
        place.ground.scattered = {};
        modified = true;
      }
      
      if (place.contents?.items_on_ground?.length > 0) {
        place.contents.items_on_ground = [];
        modified = true;
      }
      
      if (place.tiles?.cells) {
        for (const row of place.tiles.cells) {
          for (const tile of row) {
            if (tile?.contents?.length > 0) {
              tile.contents = [];
              modified = true;
            }
          }
        }
      }
      
      if (modified) {
        fs.writeFileSync(placePath, JSON.stringify(place, null, 2));
        console.log(`✓ Cleared items from place: ${placeFile}`);
      }
    } catch (err) {
      console.error(`✗ Failed to process place ${placeFile}:`, err);
    }
  }
}

console.log("\n✓ Item wipe complete!");
