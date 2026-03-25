import { debug_log } from "../shared/debug.js";

export type NPCBehaviorType = "idle_wander" | "follow" | "shopkeep";

export type ResolvedNPCBehavior = {
  requested: NPCBehaviorType;
  resolved: "idle_wander";
  fallback_reason?: string;
};

const logged_behavior_fallbacks = new Set<string>();

function infer_requested_behavior(npc: any): NPCBehaviorType {
  const explicit = String(npc?.behavior_type ?? npc?.behavior ?? "").toLowerCase();
  if (explicit.includes("follow")) return "follow";
  if (explicit.includes("shop")) return "shopkeep";
  if (explicit.includes("wander") || explicit.includes("idle")) return "idle_wander";

  const role = String(npc?.role ?? "").toLowerCase();
  if (role.includes("shop")) return "shopkeep";
  if (role.includes("follow")) return "follow";

  const title = String(npc?.title ?? "").toLowerCase();
  if (title.includes("shop")) return "shopkeep";

  const goal = String(npc?.personality?.story_goal ?? "").toLowerCase();
  if (goal.includes("follow")) return "follow";
  if (goal.includes("shop") || goal.includes("sell") || goal.includes("merchant")) return "shopkeep";

  return "idle_wander";
}

export function resolve_npc_behavior(npc_ref: string, npc: any): ResolvedNPCBehavior {
  const requested = infer_requested_behavior(npc);
  if (requested === "idle_wander") {
    return { requested, resolved: "idle_wander" };
  }

  const fallback_reason = `${requested}_stubbed_to_idle_wander`;
  const log_key = `${npc_ref}:${fallback_reason}`;
  if (!logged_behavior_fallbacks.has(log_key)) {
    logged_behavior_fallbacks.add(log_key);
    debug_log("NPC_BEHAVIOR", "Behavior stubbed to idle_wander", {
      npc_ref,
      requested,
      resolved: "idle_wander",
      fallback_reason,
    });
  }

  return {
    requested,
    resolved: "idle_wander",
    fallback_reason,
  };
}

export function should_behavior_auto_wander(npc_ref: string, npc: any): boolean {
  return resolve_npc_behavior(npc_ref, npc).resolved === "idle_wander";
}
