import type { MessageEnvelope } from "./types.js";
import { try_set_message_status } from "./message.js";
import { debug_pipeline, DEBUG_LEVEL } from "../shared/debug.js";

export type RouteResult = {
    log: MessageEnvelope;
    outbox?: MessageEnvelope;
};

export function route_message(message: MessageEnvelope): RouteResult {
    const sender = message.sender.toLowerCase();
    const type = (message.type ?? "").toLowerCase();
    const stage = message.stage ?? "";

    if (DEBUG_LEVEL >= 4) {
        debug_pipeline("Router", "routing message", { 
            sender: message.sender, 
            stage: message.stage, 
            status: message.status,
            id: message.id 
        });
    }

    const is_user = sender === "j" || sender === "user" || type === "user_input";
    const is_broker = sender === "data_broker" || type === "data_broker";
    const is_state_applier = sender === "state_applier" || stage.startsWith("applied_");
    const is_renderer = sender === "renderer_ai" || stage.startsWith("rendered_");

    let result: RouteResult;

    if (is_user) {
        const { message: sent } = try_set_message_status(message, 'sent');
        result = {
            log: sent,
            outbox: {
                ...sent,
                // NOTE: `interpreter_ai` is archived in this build.
                // Keep stage as-is if present; otherwise tag as generic user input.
                stage: sent.stage ?? "user_input",
            },
        };
    } else if (is_broker) {
        // Legacy note: data_broker used to bounce `error` messages back to interpreter.
        // That interpreter loop is archived; keep broker messages as log-only.
        result = { log: message };
    } else if (sender === "rules_lawyer" && stage.startsWith("ruling_") && message.status === "pending_state_apply") {
        // RulesLawyer outputs pending_state_apply - route to outbox for StateApplier
        result = {
            log: message,
            outbox: {
                ...message,
                status: "pending_state_apply",  // Preserve status for StateApplier
            },
        };
    } else if (is_state_applier && stage.startsWith("applied_")) {
        // State applier outputs applied_* stage - route to renderer
        result = {
            log: message,
            outbox: {
                ...message,
                status: "sent",
            },
        };
    } else if (is_renderer && stage.startsWith("rendered_")) {
        // Renderer outputs rendered_* stage - log only, no routing needed
        result = { log: message };
    } else if (stage.startsWith("npc_response")) {
        // NPC AI responses - route to outbox for renderer to display
        result = {
            log: message,
            outbox: {
                ...message,
                status: "sent",
            },
        };
    } else {
        result = { log: message };
    }

    if (DEBUG_LEVEL >= 3) {
        debug_pipeline("Router", "routed", { 
            sender: message.sender,
            stage: message.stage,
            hasOutbox: !!result.outbox,
            outboxStage: result.outbox?.stage,
            outboxStatus: result.outbox?.status
        });
    }

    return result;
}
