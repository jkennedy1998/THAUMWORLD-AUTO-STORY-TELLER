// Social Checks
// Determines if NPCs react to overheard communication
// Tabletop concept: "Does the NPC care enough to respond?"

import { debug_log } from "../shared/debug.js";
import type { VolumeLevel } from "../interface_program/communication_input.js";
import { getVolumeRange } from "../interface_program/communication_input.js";

export interface SocialCheckResult {
  responds: boolean;
  interest_level: number; // 0-100
  response_type: "join" | "eavesdrop" | "ignore";
}

export interface PersonalityProfile {
  curiosity: number;      // 0-10
  extraversion: number;   // 0-10
  gossip_tendency: number; // 0-10
  suspicious: number;     // 0-10
  interests?: string[];   // Topics they care about
  is_shopkeeper?: boolean; // True if NPC owns/runs a shop
  home_place_id?: string;  // The place they consider "home" (shop, house, etc.)
}

// Thresholds
const JOIN_THRESHOLD = 70;
const EAVESDROP_THRESHOLD = 40;

/**
 * Calculate social response to communication
 * Returns whether NPC reacts and how strongly
 */
export function calculateSocialResponse(
  npc_personality: PersonalityProfile,
  message: string,
  volume: VolumeLevel,
  distance: number,
  speaker_ref: string,
  relationship_fondness: number = 0,
  current_place_id?: string,  // Where the conversation is happening
  is_direct_address: boolean = false  // True if player specifically targeted this NPC
): SocialCheckResult {
  let interest = 0;
  
  // 1. Base Curiosity (0-30 points)
  interest += (npc_personality.curiosity || 5) * 3;
  
  // 1b. Shopkeeper Professional Interest (0-40 points)
  // Shop owners are interested in customers in their shop
  if (npc_personality.is_shopkeeper && current_place_id) {
    const is_in_their_shop = npc_personality.home_place_id === current_place_id;
    if (is_in_their_shop) {
      // Big bonus for being a customer in their establishment
      interest += 40;
      // Extra bonus if directly addressed (good customer service!)
      if (is_direct_address) {
        interest += 20;
      }
    }
  }
  
  // 2. Distance Factor (0-20 points)
  // Closer = more interesting
  const max_range = getVolumeRange(volume);
  const distance_factor = Math.max(0, 1 - (distance / max_range));
  interest += distance_factor * 20;
  
  // 3. Content Relevance (0-40 points)
  const message_lower = message.toLowerCase();
  if (npc_personality.interests) {
    for (const interest_keyword of npc_personality.interests) {
      if (message_lower.includes(interest_keyword.toLowerCase())) {
        interest += 20;
      }
    }
  }
  
  // 4. Relationship Bonus (-20 to +20 points)
  interest += relationship_fondness * 2;
  
  // 5. Gossip Factor (0-15 points)
  if ((npc_personality.gossip_tendency || 5) > 5) {
    if (message_lower.includes("secret") || 
        message_lower.includes("heard") ||
        message_lower.includes("rumor")) {
      interest += 15;
    }
  }
  
  // 6. Suspiciousness (0-15 points)
  // Whispering is suspicious!
  if ((npc_personality.suspicious || 5) > 5 && volume === "WHISPER") {
    interest += 15;
  }
  
  // 7. Shout attracts attention (0-10 points)
  if (volume === "SHOUT") {
    interest += 10;
  }
  
  // Cap at 100
  interest = Math.min(100, interest);
  
  // Determine response
  if (interest >= JOIN_THRESHOLD) {
    return {
      responds: true,
      interest_level: interest,
      response_type: "join"
    };
  } else if (interest >= EAVESDROP_THRESHOLD) {
    return {
      responds: true,
      interest_level: interest,
      response_type: "eavesdrop"
    };
  } else {
    return {
      responds: false,
      interest_level: interest,
      response_type: "ignore"
    };
  }
}

/**
 * Check if NPC should remember this conversation
 * Based on interest level
 */
export function shouldRemember(
  interest_level: number,
  is_direct_participant: boolean
): boolean {
  if (is_direct_participant) {
    return true; // Always remember direct conversations
  }
  
  // Bystanders only remember if interested enough
  return interest_level >= 50;
}

/**
 * Calculate memory importance (1-10 scale)
 */
export function calculateMemoryImportance(
  interest_level: number,
  is_direct_participant: boolean,
  contains_secret: boolean
): number {
  let importance = 0;
  
  // Base from interest (0-5)
  importance += Math.floor(interest_level / 20);
  
  // Participant bonus (+2)
  if (is_direct_participant) {
    importance += 2;
  }
  
  // Secret bonus (+2)
  if (contains_secret) {
    importance += 2;
  }
  
  // Cap at 10
  return Math.min(10, importance);
}

/**
 * Get default personality for NPC
 * Used if NPC doesn't have personality defined
 * Includes shopkeeper info for known shop owners
 */
export function getDefaultPersonality(npc_ref?: string): PersonalityProfile {
  // Shopkeeper definitions - add more as needed
  const shopkeepers: Record<string, { place_id: string; interests: string[] }> = {
    "npc.grenda": {
      place_id: "eden_crossroads_grendas_shop",
      interests: ["trade", "herbs", "potions", "customers", "news"]
    }
  };

  // Other archetypal personalities (non-shopkeepers)
  const special: Record<string, PersonalityProfile> = {
    // Shop assistant: chatty enough to eavesdrop/join during testing.
    "npc.mira": {
      curiosity: 8,
      extraversion: 6,
      gossip_tendency: 8,
      suspicious: 4,
      interests: ["customers", "trade", "rumor", "secret", "news"],
      is_shopkeeper: false,
      home_place_id: "eden_crossroads_grendas_shop",
    },
  };

  if (npc_ref && special[npc_ref]) {
    return special[npc_ref];
  }
  
  // Check if this NPC is a known shopkeeper
  if (npc_ref && shopkeepers[npc_ref]) {
    return {
      curiosity: 6,
      extraversion: 7,
      gossip_tendency: 6,
      suspicious: 4,
      interests: shopkeepers[npc_ref].interests,
      is_shopkeeper: true,
      home_place_id: shopkeepers[npc_ref].place_id
    };
  }
  
  // Default personality for non-shopkeepers
  return {
    curiosity: 5,
    extraversion: 5,
    gossip_tendency: 5,
    suspicious: 5,
    interests: ["news", "gossip", "help"],
    is_shopkeeper: false
  };
}

/**
 * Log social check for debugging
 */
export function logSocialCheck(
  npc_ref: string,
  result: SocialCheckResult,
  context: {
    message: string;
    distance: number;
    volume: VolumeLevel;
  }
): void {
  debug_log("[SOCIAL]", `${npc_ref} interest: ${result.interest_level}/100`, {
    response_type: result.response_type,
    responds: result.responds,
    distance: context.distance,
    volume: context.volume,
    message_preview: context.message.slice(0, 30)
  });
}
