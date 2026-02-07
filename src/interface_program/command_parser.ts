// Command Parser for Player Input
// Maps natural language player commands to ActionIntents

import { createIntent, type ActionIntent } from "../action_system/intent.js";
import type { ActionCost } from "../shared/constants.js";

// Simple command patterns
const COMMAND_PATTERNS = [
  // Movement
  { pattern: /^(?:move|go|walk)\s+(?:to\s+)?(?:the\s+)?(north|south|east|west|up|down|here|there|outside|inside)$/i, verb: "MOVE", extractTarget: (m: RegExpMatchArray) => `place.${m[1]}` },
  { pattern: /^(?:move|go|walk)\s+to\s+(.+)$/i, verb: "MOVE", extractTarget: (m: RegExpMatchArray) => m[1] },
  
  // Communication
  { pattern: /^(?:say|shout|yell|whisper)\s+(.+)$/i, verb: "COMMUNICATE", extractContent: (m: RegExpMatchArray) => m[1] },
  { pattern: /^(?:talk|speak)\s+to\s+(.+)$/i, verb: "COMMUNICATE", extractTarget: (m: RegExpMatchArray) => m[1] },
  
  // Attack
  { pattern: /^(?:attack|hit|strike|slash|stab|shoot)\s+(?:at\s+)?(?:the\s+)?(.+)$/i, verb: "USE.IMPACT_SINGLE", extractTarget: (m: RegExpMatchArray) => m[1] },
  { pattern: /^(?:fire|shoot)\s+(?:at\s+)?(?:the\s+)?(.+)$/i, verb: "USE.PROJECTILE_SINGLE", extractTarget: (m: RegExpMatchArray) => m[1] },
  
  // Inspect
  { pattern: /^(?:look|inspect|examine|check)\s+(?:at\s+)?(?:the\s+)?(.+)$/i, verb: "INSPECT", extractTarget: (m: RegExpMatchArray) => m[1] },
  { pattern: /^look$/i, verb: "INSPECT", extractTarget: () => "self" },
  
  // Use/Interact
  { pattern: /^(?:use|activate|interact\s+with)\s+(?:the\s+)?(.+)$/i, verb: "USE", extractTarget: (m: RegExpMatchArray) => m[1] },
  
  // Help
  { pattern: /^help$/i, verb: "HELP", extractTarget: () => undefined },
  { pattern: /^help\s+(.+)$/i, verb: "HELP", extractTarget: (m: RegExpMatchArray) => m[1] },
];

/**
 * Parse player text input into an ActionIntent
 * Returns null if input doesn't match any known pattern
 */
export function parsePlayerCommand(
  input: string, 
  actorRef: string
): { intent: ActionIntent; isHandled: true } | { isHandled: false } {
  const trimmed = input.trim();
  
  for (const cmd of COMMAND_PATTERNS) {
    const match = trimmed.match(cmd.pattern);
    if (match) {
      const target = cmd.extractTarget?.(match);
      const content = cmd.extractContent?.(match);
      
      const intent = createIntent(
        actorRef,
        cmd.verb as any,
        "player_input",
        {
          targetRef: target,
          parameters: content ? { message: content } : {},
          originalInput: trimmed
        }
      );
      
      return { intent, isHandled: true };
    }
  }
  
  // Not a recognized command - fall back to old interpreter
  return { isHandled: false };
}

/**
 * Check if input looks like a system/debug command
 */
export function isSystemCommand(input: string): boolean {
  const systemPrefixes = ["/", "!", "#", "$", "debug:", "test:", "admin:"];
  const trimmed = input.trim().toLowerCase();
  return systemPrefixes.some(prefix => trimmed.startsWith(prefix));
}

/**
 * Get help text for available commands
 */
export function getCommandHelp(): string {
  return `
Available Commands:
  Movement:    move north, go south, walk to [place]
  Communication: say [message], talk to [npc]
  Combat:      attack [target], shoot [target]
  Inspection:  look, inspect [thing], examine [target]
  Interaction: use [item], activate [object]
  Help:        help, help [topic]

System Commands:
  /create      - Start character creation
  /status      - Show game status
`;
}
