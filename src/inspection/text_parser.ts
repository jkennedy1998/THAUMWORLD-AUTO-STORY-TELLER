// Text Parser for Inspection Commands
// Parses player text input for inspection commands and keywords

export interface InspectionParseResult {
  is_inspect: boolean;
  target_name?: string;
  feature_keywords: string[];
  body_slot?: string;
}

// Keywords mapped to inspection categories
const KEYWORD_MAP: Record<string, string[]> = {
  equipment: [
    "clothes", "armor", "equipment", "weapon", "wearing", "holding", "gear",
    "outfit", "attire", "garments", "vestments",
    "sheathed", "drawn", "stowed", "brandished"
  ],
  physical: [
    "appearance", "face", "body", "build", "hair", "eyes", "features",
    "stature", "figure", "physique", "complexion",
    "scars", "marks", "tattoos", "blemishes"
  ],
  status: [
    "health", "wounds", "injured", "status", "condition", "hurt",
    "bleeding", "fatigued", "exhausted", "winded",
    "poisoned", "cursed", "afflicted", "ailing"
  ],
  inventory: [
    "carrying", "inventory", "items", "pockets", "bag", "pack",
    "satchel", "pouch", "belt", "backpack",
    "equipped", "worn", "held"
  ],
  identity: [
    "name", "who", "what", "race", "kind", "profession", "job",
    "occupation", "title", "background", "lineage",
    "affiliation", "faction", "allegiance"
  ],
  behavior: [
    "doing", "action", "activity", "intent", "plan",
    "mannerisms", "posture", "stance", "gait",
    "demeanor", "attitude", "mood", "temperament"
  ]
};

// Body slot keywords
const BODY_SLOT_KEYWORDS: Record<string, string[]> = {
  head: ["head", "helmet", "hat", "crown"],
  body: ["body", "chest", "torso", "armor", "shirt", "tunic"],
  main_hand: ["main hand", "weapon", "sword", "right hand"],
  off_hand: ["off hand", "shield", "left hand", "secondary"],
  legs: ["legs", "pants", "trousers"],
  feet: ["feet", "boots", "shoes"]
};

// Inspection verbs
const INSPECT_VERBS = [
  "inspect", "examine", "look at", "check", "survey", 
  "study", "observe", "peer at", "scrutinize"
];

/**
 * Parse text for inspection commands
 */
export function parse_inspect_command(text: string): InspectionParseResult {
  const lowered = text.toLowerCase();
  
  // Check for inspect verbs
  const is_inspect = INSPECT_VERBS.some(verb => lowered.includes(verb));
  
  if (!is_inspect) {
    return { is_inspect: false, feature_keywords: [] };
  }
  
  // Extract target name
  const target_name = extract_target_name(lowered);
  
  // Extract feature keywords
  const feature_keywords = extract_feature_keywords(lowered);
  
  // Check for body slot specification
  const body_slot = extract_body_slot(lowered);
  
  return {
    is_inspect,
    target_name,
    feature_keywords,
    body_slot
  };
}

/**
 * Extract target name from inspection text
 * Example: "inspect the guard" -> "guard"
 */
function extract_target_name(text: string): string | undefined {
  // Remove inspect verbs and get what follows
  let cleaned = text;
  for (const verb of INSPECT_VERBS) {
    cleaned = cleaned.replace(verb, "").trim();
  }
  
  // Remove common articles and prepositions
  cleaned = cleaned
    .replace(/^(the|a|an|at|on|in)\s+/i, "")
    .replace(/\s+(for|with|using)\s+.+$/, "")
    .trim();
  
  // Get first word or short phrase
  const words = cleaned.split(/\s+/);
  if (words.length === 0) return undefined;
  
  // Return first 1-2 words as target name
  if (words.length > 2 && words[0] && words[1]) {
    return `${words[0]} ${words[1]}`;
  }
  
  return words[0];
}

/**
 * Extract feature keywords from text
 */
function extract_feature_keywords(text: string): string[] {
  const found: string[] = [];
  
  for (const [category, keywords] of Object.entries(KEYWORD_MAP)) {
    if (keywords.some(kw => text.includes(kw))) {
      found.push(category);
    }
  }
  
  return found;
}

/**
 * Extract body slot from text
 * Example: "inspect his armor" -> "body"
 */
function extract_body_slot(text: string): string | undefined {
  for (const [slot, keywords] of Object.entries(BODY_SLOT_KEYWORDS)) {
    if (keywords.some(kw => text.includes(kw))) {
      return slot;
    }
  }
  return undefined;
}

/**
 * Check if text is a question (might want to inspect something)
 */
export function is_inspection_question(text: string): boolean {
  const lowered = text.toLowerCase();
  
  // Questions about appearance
  if (/\b(what|who|how)\b.*\b(look|appear|seem|wearing|carrying)\b/.test(lowered)) {
    return true;
  }
  
  // Questions about condition
  if (/\b(is|does)\b.*\b(look|seem|appear)\b.*\b(healthy|hurt|injured|wounded)\b/.test(lowered)) {
    return true;
  }
  
  return false;
}

/**
 * Suggest inspection targets from available targets
 */
export function suggest_inspect_target(
  text: string,
  available_targets: Array<{ name: string; ref: string }>
): { name: string; ref: string } | null {
  const lowered = text.toLowerCase();
  
  for (const target of available_targets) {
    const target_name_lower = target.name.toLowerCase();
    const target_ref_lower = target.ref.toLowerCase();
    
    // Check if text contains target name or ref
    if (
      lowered.includes(target_name_lower) ||
      lowered.includes(target_ref_lower.replace(/^npc\./, "").replace(/^actor\./, ""))
    ) {
      return target;
    }
  }
  
  return null;
}

// Example usage:
// parse_inspect_command("inspect the guard's armor")
// -> { is_inspect: true, target_name: "guard", feature_keywords: ["equipment"], body_slot: "body" }

// parse_inspect_command("look at the sword on the table")
// -> { is_inspect: true, target_name: "sword", feature_keywords: ["equipment"], body_slot: undefined }

// parse_inspect_command("check his wounds")
// -> { is_inspect: true, target_name: "his", feature_keywords: ["status"], body_slot: undefined }
