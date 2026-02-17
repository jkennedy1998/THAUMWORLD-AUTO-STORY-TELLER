// Meta Tag Processor
// Applies meta-tag mechanics like DISPERSING to modify tag behavior over time

import { debug_event } from "../shared/debug_event.js";
import { tagRegistry } from "./registry.js";
import type { TagInstance } from "./registry.js";
import { load_actor, save_actor, find_actors } from "../actor_storage/store.js";
import { load_npc, save_npc, find_npcs } from "../npc_storage/store.js";

/**
 * MetaTagProcessor - Handles meta-tag mechanics
 * Currently implements: [DISPERSING] - auto-remove 1 MAG per turn
 */
export class MetaTagProcessor {
  
  /**
   * Process dispersing tags on all entities in a data slot
   * Decreases MAG by 1 for any tag with [DISPERSING] meta tag
   * Removes tag when MAG reaches 0
   */
  static async processDispersingTags(slot: number): Promise<void> {
    debug_event("META.TAGS", "process_dispersing.start", { slot });
    
    // Process all actors
    const actors = find_actors(slot, {});
    for (const actor of actors) {
      if (actor.id) {
        const result = load_actor(slot, actor.id);
        if (result.ok && result.actor) {
          const actorData = result.actor;
          if (actorData.tags && Array.isArray(actorData.tags) && actorData.tags.length > 0) {
            const changes = this.processDispersingForEntity(`actor.${actor.id}`, actorData.tags);
            if (changes.length > 0) {
              // Remove tags that reached 0
              actorData.tags = actorData.tags.filter((tag: TagInstance) => tag.mag > 0);
              // Save the actor
              save_actor(slot, actor.id, actorData);
            }
          }
        }
      }
    }
    
    // Process all NPCs
    const npcs = find_npcs(slot, {});
    for (const npc of npcs) {
      if (npc.id) {
        const result = load_npc(slot, npc.id);
        if (result.ok && result.npc) {
          const npcData = result.npc;
          if (npcData.tags && Array.isArray(npcData.tags) && npcData.tags.length > 0) {
            const changes = this.processDispersingForEntity(`npc.${npc.id}`, npcData.tags);
            if (changes.length > 0) {
              // Remove tags that reached 0
              npcData.tags = npcData.tags.filter((tag: TagInstance) => tag.mag > 0);
              // Save the NPC
              save_npc(slot, npc.id, npcData);
            }
          }
        }
      }
    }
    
    debug_event("META.TAGS", "process_dispersing.complete", { slot });
  }
  
  /**
   * Process dispersing tags for a single entity
   * Returns array of changes made for debug logging
   */
  static processDispersingForEntity(entityId: string, tags: TagInstance[]): Array<{
    tagName: string;
    oldMag: number;
    newMag: number;
    removed: boolean;
  }> {
    const changes: Array<{
      tagName: string;
      oldMag: number;
      newMag: number;
      removed: boolean;
    }> = [];
    
    for (const tag of tags) {
      // Check if this tag has the DISPERSING meta tag
      const hasDispersing = tag.meta && tag.meta.includes("DISPERSING");
      
      if (hasDispersing) {
        const oldMag = tag.mag;
        const newMag = Math.max(0, tag.mag - 1);
        
        if (newMag === 0) {
          // Tag will be removed
          changes.push({
            tagName: tag.name,
            oldMag,
            newMag: 0,
            removed: true
          });
          
          debug_event("META.TAGS", "tag.dispersing.removed", {
            entity: entityId,
            tag: tag.name,
            mag: oldMag
          });
        } else {
          // Tag magnitude decreased
          tag.mag = newMag;
          changes.push({
            tagName: tag.name,
            oldMag,
            newMag,
            removed: false
          });
          
          debug_event("META.TAGS", "tag.dispersing.decreased", {
            entity: entityId,
            tag: tag.name,
            oldMag,
            newMag
          });
        }
      }
    }
    
    return changes;
  }
  
  /**
   * Check if a tag instance should disperse
   */
  static shouldDisperse(tag: TagInstance): boolean {
    if (!tag.meta || tag.meta.length === 0) return false;
    
    return tag.meta.includes("DISPERSING");
  }
}

export default MetaTagProcessor;