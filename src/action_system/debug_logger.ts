// Debug Logger for Action System
// Provides detailed logging for testing the action pipeline

import type { ActionIntent, ActionResult, ActionEffect } from "../action_system/intent.js";
import type { TaggedItem, ActionCapability } from "../tag_system/index.js";
import type { RollResult, PotencyResult } from "../roll_system/index.js";

/**
 * Debug log levels
 */
export type LogLevel = "error" | "warn" | "info" | "debug" | "trace";

/**
 * Debug configuration
 */
export interface DebugConfig {
  enabled: boolean;
  level: LogLevel;
  logToConsole: boolean;
  logToFile: boolean;
  filePath?: string;
}

/**
 * Default debug config
 */
export const DEFAULT_DEBUG_CONFIG: DebugConfig = {
  enabled: true,
  level: "debug",
  logToConsole: true,
  logToFile: false
};

// Log level priorities
const LOG_PRIORITIES: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4
};

/**
 * Debug logger class
 */
export class DebugLogger {
  private config: DebugConfig;
  private logs: string[] = [];

  constructor(config: Partial<DebugConfig> = {}) {
    this.config = { ...DEFAULT_DEBUG_CONFIG, ...config };
  }

  /**
   * Log a message
   */
  log(level: LogLevel, message: string, data?: any): void {
    if (!this.config.enabled) return;
    if (LOG_PRIORITIES[level] > LOG_PRIORITIES[this.config.level]) return;

    const timestamp = new Date().toISOString();
    const dataStr = data ? ` | ${JSON.stringify(data)}` : "";
    const logLine = `[${timestamp}] [${level.toUpperCase()}] ${message}${dataStr}`;

    this.logs.push(logLine);

    if (this.config.logToConsole) {
      console.log(logLine);
    }
  }

  /**
   * Convenience methods
   */
  error(message: string, data?: any): void { this.log("error", message, data); }
  warn(message: string, data?: any): void { this.log("warn", message, data); }
  info(message: string, data?: any): void { this.log("info", message, data); }
  debug(message: string, data?: any): void { this.log("debug", message, data); }
  trace(message: string, data?: any): void { this.log("trace", message, data); }

  /**
   * Get all logs
   */
  getLogs(): string[] {
    return [...this.logs];
  }

  /**
   * Clear logs
   */
  clear(): void {
    this.logs = [];
  }

  /**
   * Export logs to string
   */
  export(): string {
    return this.logs.join("\n");
  }
}

// Singleton instance
export const debugLogger = new DebugLogger();

/**
 * Log action intent details
 */
export function logActionIntent(
  logger: DebugLogger,
  intent: ActionIntent,
  label: string = "Action Intent"
): void {
  logger.debug(`${label}:`, {
    id: intent.id,
    actor: intent.actorRef,
    verb: intent.verb,
    subtype: intent.parameters?.subtype,
    target: intent.targetRef,
    location: {
      actor: `(${intent.actorLocation.x},${intent.actorLocation.y})`,
      target: intent.targetLocation ? `(${intent.targetLocation.x},${intent.targetLocation.y})` : null
    },
    cost: intent.actionCost,
    status: intent.status,
    parameters: Object.keys(intent.parameters || {})
  });
}

/**
 * Log tool validation details
 */
export function logToolValidation(
  logger: DebugLogger,
  actorRef: string,
  tool: TaggedItem | null,
  capability: ActionCapability | undefined,
  isValid: boolean
): void {
  logger.debug(`Tool Validation:`, {
    actor: actorRef,
    hasTool: !!tool,
    toolName: tool?.name,
    toolTags: tool?.tags?.map(t => `${t.name}:${t.stacks}`),
    hasCapability: !!capability,
    actionType: capability?.action_type,
    proficiencies: capability?.proficiencies,
    range: capability?.range,
    isValid
  });
}

/**
 * Log roll details
 */
export function logRoll(
  logger: DebugLogger,
  resultRoll: RollResult,
  potencyRoll: PotencyResult | null,
  label: string = "Roll"
): void {
  logger.info(`${label}:`, {
    result: {
      nat: resultRoll.nat,
      prof: resultRoll.prof_bonus,
      stat: resultRoll.stat_bonus,
      shift: resultRoll.effector_shift,
      scale: resultRoll.effector_scale,
      total: resultRoll.total,
      cr: resultRoll.cr,
      success: resultRoll.success,
      margin: resultRoll.margin
    },
    potency: potencyRoll ? {
      mag: potencyRoll.mag,
      dice: potencyRoll.dice,
      roll: potencyRoll.roll,
      shift: potencyRoll.effector_shift,
      scale: potencyRoll.effector_scale,
      total: potencyRoll.total
    } : null
  });
}

/**
 * Log action result
 */
export function logActionResult(
  logger: DebugLogger,
  result: ActionResult,
  label: string = "Action Result"
): void {
  logger.info(`${label}:`, {
    success: result.success,
    effectCount: result.effects.length,
    effects: result.effects.map(e => ({
      type: e.type,
      target: e.targetRef,
      applied: e.applied,
      error: e.error
    })),
    summary: result.summary,
    failureReason: result.failureReason,
    observedBy: result.observedBy
  });
}

/**
 * Log effector application
 */
export function logEffectors(
  logger: DebugLogger,
  baseValue: number,
  finalValue: number,
  shift: number,
  scale: number,
  effectors: Array<{ type: string; value: number; source: string }>,
  label: string = "Effectors"
): void {
  logger.debug(`${label}:`, {
    base: baseValue,
    shift,
    scale,
    final: finalValue,
    sources: effectors.map(e => `${e.source}: ${e.type} ${e.value}`)
  });
}

/**
 * Create a visual separator in logs
 */
export function logSeparator(
  logger: DebugLogger,
  title: string = "",
  char: string = "="
): void {
  const line = char.repeat(50);
  if (title) {
    logger.info(`${line}`);
    logger.info(`  ${title}`);
    logger.info(`${line}`);
  } else {
    logger.info(line);
  }
}

/**
 * Log pipeline stage
 */
export function logPipelineStage(
  logger: DebugLogger,
  stage: string,
  status: "start" | "complete" | "failed",
  data?: any
): void {
  const icon = status === "start" ? "▶" : status === "complete" ? "✓" : "✗";
  logger.debug(`[${icon}] Stage: ${stage} (${status})`, data);
}

/**
 * Test helper: Create a test actor
 */
export function createTestActor(
  ref: string = "actor.test_player",
  options: {
    name?: string;
    proficiencies?: Record<string, number>;
    stats?: Record<string, number>;
    equippedTool?: TaggedItem;
  } = {}
): any {
  return {
    ref,
    name: options.name || "Test Player",
    proficiencies: {
      Accuracy: 2,
      Brawn: 1,
      Instinct: 1,
      ...options.proficiencies
    },
    stats: {
      STR: 12,
      DEX: 14,
      CON: 10,
      INT: 10,
      WIS: 12,
      CHA: 10,
      PER: 12,
      ...options.stats
    },
    hand_slots: {
      main_hand: options.equippedTool || null
    },
    body_slots: {
      head: { name: "head", item: null },
      torso: { name: "torso", item: null }
    }
  };
}

/**
 * Test helper: Create a test tool
 */
export function createTestTool(
  name: string,
  mag: number,
  tags: Array<{ name: string; stacks?: number; value?: any }>,
  options: { weight?: number; ref?: string } = {}
): TaggedItem {
  return {
    ref: options.ref || `item.test_${name.toLowerCase().replace(/\s+/g, "_")}`,
    name,
    weight: options.weight || 5,
    tags: tags.map(t => ({
      name: t.name,
      stacks: t.stacks || 1,
      value: t.value
    }))
  };
}

/**
 * Test helper: Create a test NPC
 */
export function createTestNPC(
  ref: string = "npc.test_guard",
  location: { x: number; y: number } = { x: 5, y: 5 },
  options: { name?: string; hostile?: boolean } = {}
): any {
  return {
    ref,
    name: options.name || "Test Guard",
    location: {
      world_x: 0,
      world_y: 0,
      region_x: 0,
      region_y: 0,
      x: location.x,
      y: location.y
    },
    hostile: options.hostile ?? false
  };
}

/**
 * Print test scenario header
 */
export function printTestScenario(
  logger: DebugLogger,
  scenario: string,
  steps: string[]
): void {
  logSeparator(logger, `TEST: ${scenario}`);
  logger.info("Steps:");
  steps.forEach((step, i) => {
    logger.info(`  ${i + 1}. ${step}`);
  });
  logger.info("");
}

/**
 * Print test summary
 */
export function printTestSummary(
  logger: DebugLogger,
  results: Array<{ step: string; passed: boolean; error?: string }>
): void {
  logSeparator(logger, "TEST SUMMARY");
  
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  
  results.forEach((result, i) => {
    const icon = result.passed ? "✓" : "✗";
    const status = result.passed ? "PASS" : "FAIL";
    logger.info(`${icon} Step ${i + 1}: ${result.step} [${status}]`);
    if (result.error) {
      logger.error(`   Error: ${result.error}`);
    }
  });
  
  logger.info("");
  logger.info(`Results: ${passed} passed, ${failed} failed, ${results.length} total`);
  logSeparator(logger);
}
