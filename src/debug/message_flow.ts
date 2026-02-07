// Message Flow Debugger
// Traces messages through the entire pipeline to diagnose flow issues

import { debug_log, debug_warn, debug_error } from "../shared/debug.js";
import { read_outbox } from "../engine/outbox_store.js";
import { get_outbox_path } from "../engine/paths.js";

let lastMessageState: Map<string, any> = new Map();
let messageHistory: Array<{ timestamp: number; id: string; change: string; details: any }> = [];

/**
 * Trace a message through the system
 */
export function traceMessage(
  id: string, 
  stage: string, 
  status: string, 
  sender: string,
  details?: any
): void {
  const key = `${id}-${stage}`;
  const previous = lastMessageState.get(key);
  
  const entry = {
    timestamp: Date.now(),
    id,
    change: previous ? `${previous.status} → ${status}` : `NEW (${status})`,
    details: {
      stage,
      sender,
      ...details
    }
  };
  
  messageHistory.push(entry);
  lastMessageState.set(key, { stage, status, sender, timestamp: Date.now() });
  
  // Log significant state changes
  if (!previous || previous.status !== status) {
    debug_log("[MSG_FLOW]", `${id} ${entry.change}`, {
      stage,
      sender,
      timeSinceLastChange: previous ? Date.now() - previous.timestamp : 0
    });
  }
}

/**
 * Analyze message flow issues
 */
export function analyzeMessageFlow(dataSlot: number): {
  stuckMessages: any[];
  flowIssues: string[];
  stats: { total: number; byStatus: Record<string, number>; byStage: Record<string, number> };
} {
  const outbox_path = get_outbox_path(dataSlot);
  const outbox = read_outbox(outbox_path);
  
  const stuckMessages: any[] = [];
  const flowIssues: string[] = [];
  const stats = {
    total: outbox.messages.length,
    byStatus: {} as Record<string, number>,
    byStage: {} as Record<string, number>
  };
  
  for (const msg of outbox.messages) {
    // Count stats
    const status = msg.status ?? "unknown";
    stats.byStatus[status] = (stats.byStatus[status] ?? 0) + 1;
    const stage = msg.stage ?? "unknown";
    stats.byStage[stage] = (stats.byStage[stage] ?? 0) + 1;
    
    // Check for stuck messages - ruling messages with wrong status
    if (msg.stage?.startsWith("ruling_") && msg.status === "done") {
      // This is actually OK - StateApplier marks rulings as done after processing
      // Only flag as issue if it's a recent message (processed in last 5 minutes)
      const msgTimestamp = (msg as any).timestamp ?? Date.now();
      const age = Date.now() - msgTimestamp;
      if (age < 300000) { // 5 minutes
        // Normal flow - StateApplier processed this ruling
        // Don't flag as stuck
      }
    }
    
    // Check for rulings stuck in pending_state_apply (not being processed)
    if (msg.stage?.startsWith("ruling_") && msg.status === "pending_state_apply") {
      const msgTimestamp = (msg as any).timestamp ?? Date.now();
      const processingTime = Date.now() - msgTimestamp;
      if (processingTime > 30000) { // 30 seconds
        stuckMessages.push({
          id: msg.id,
          stage: msg.stage,
          status: msg.status,
          processingTimeMs: processingTime,
          issue: "Ruling stuck in pending_state_apply for >30s",
          recommendation: "StateApplier may not be running or message is locked"
        });
      }
    }
    
    if (msg.stage?.startsWith("ruling_") && msg.status === "superseded") {
      const hasNewerRuling = outbox.messages.some(m => 
        m.id !== msg.id && 
        m.stage?.startsWith("ruling_") && 
        m.correlation_id === msg.correlation_id &&
        m.status === "pending_state_apply"
      );
      
      if (!hasNewerRuling) {
        stuckMessages.push({
          id: msg.id,
          stage: msg.stage,
          status: msg.status,
          issue: "Superseded ruling with no newer ruling",
          recommendation: "May indicate pipeline stuck"
        });
      }
    }
    
    // Check for messages stuck in processing
    if (msg.status === "processing") {
      const msgTimestamp = (msg as any).timestamp ?? Date.now();
      const processingTime = Date.now() - msgTimestamp;
      if (processingTime > 30000) { // 30 seconds
        stuckMessages.push({
          id: msg.id,
          stage: msg.stage,
          status: msg.status,
          processingTimeMs: processingTime,
          issue: "Message stuck in processing for >30s",
          recommendation: "Check if component died or is hung"
        });
      }
    }
  }
  
  // Detect flow issues
  const hasRulingPending = outbox.messages.some(m => 
    m.stage?.startsWith("ruling_") && m.status === "pending_state_apply"
  );
  
  const hasRulingDone = outbox.messages.some(m => 
    m.stage?.startsWith("ruling_") && m.status === "done"
  );
  
  if (hasRulingDone && !hasRulingPending) {
    flowIssues.push("All rulings marked 'done' - StateApplier cannot process them");
    flowIssues.push("Root cause: Something is marking rulings as done instead of pending_state_apply");
  }
  
  return { stuckMessages, flowIssues, stats };
}

/**
 * Print message flow report
 */
export function printMessageFlowReport(dataSlot: number): void {
  const { stuckMessages, flowIssues, stats } = analyzeMessageFlow(dataSlot);
  
  debug_log("[MSG_FLOW_REPORT]", "=".repeat(60));
  debug_log("[MSG_FLOW_REPORT]", `Total messages: ${stats.total}`);
  debug_log("[MSG_FLOW_REPORT]", `By status: ${JSON.stringify(stats.byStatus)}`);
  debug_log("[MSG_FLOW_REPORT]", `By stage: ${JSON.stringify(stats.byStage)}`);
  
  if (flowIssues.length > 0) {
    debug_warn("[MSG_FLOW_REPORT]", "FLOW ISSUES DETECTED:");
    flowIssues.forEach(issue => debug_warn("[MSG_FLOW_REPORT]", `  ⚠ ${issue}`));
  }
  
  if (stuckMessages.length > 0) {
    debug_warn("[MSG_FLOW_REPORT]", `STUCK MESSAGES (${stuckMessages.length}):`);
    stuckMessages.forEach(msg => {
      debug_warn("[MSG_FLOW_REPORT]", `  📌 ${msg.id}`);
      debug_warn("[MSG_FLOW_REPORT]", `     Stage: ${msg.stage}, Status: ${msg.status}`);
      debug_warn("[MSG_FLOW_REPORT]", `     Issue: ${msg.issue}`);
      debug_warn("[MSG_FLOW_REPORT]", `     Fix: ${msg.recommendation}`);
    });
  }
  
  debug_log("[MSG_FLOW_REPORT]", "=".repeat(60));
}

/**
 * Get message flow history
 */
export function getMessageFlowHistory(id?: string): any[] {
  if (id) {
    return messageHistory.filter(h => h.id === id);
  }
  return [...messageHistory];
}

// Export singleton for global access
export const messageFlowDebugger = {
  trace: traceMessage,
  analyze: analyzeMessageFlow,
  printReport: printMessageFlowReport,
  getHistory: getMessageFlowHistory
};
