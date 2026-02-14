// Archived legacy router (interpreter stage)
//
// Date: 2026-02-13
//
// This file preserves the older routing behavior that defaulted user input to
// stage "interpreter_ai" and re-queued data_broker errors back to interpreter.
//
// The current build executes core actions via the ActionPipeline in
// interface_program; interpreter_ai is archived.

import type { MessageEnvelope } from "../../src/engine/types.js";
import { try_set_message_status } from "../../src/engine/message.js";
import { debug_pipeline, DEBUG_LEVEL } from "../../src/shared/debug.js";

export type RouteResult = {
  log: MessageEnvelope;
  outbox?: MessageEnvelope;
};

export function route_message_legacy_interpreter(message: MessageEnvelope): RouteResult {
  const sender = message.sender.toLowerCase();
  const type = (message.type ?? "").toLowerCase();
  const stage = message.stage ?? "";

  if (DEBUG_LEVEL >= 4) {
    debug_pipeline("Router", "routing message", {
      sender: message.sender,
      stage: message.stage,
      status: message.status,
      id: message.id,
    });
  }

  const is_user = sender === "j" || sender === "user" || type === "user_input";
  const is_interpreter = sender === "interpreter_ai" || type === "interpreter_ai";
  const is_broker = sender === "data_broker" || type === "data_broker";
  const is_state_applier = sender === "state_applier" || stage.startsWith("applied_");
  const is_renderer = sender === "renderer_ai" || stage.startsWith("rendered_");

  let result: RouteResult;

  if (is_user) {
    const { message: sent } = try_set_message_status(message, "sent");
    result = {
      log: sent,
      outbox: {
        ...sent,
        stage: sent.stage ?? "interpreter_ai",
      },
    };
  } else if (is_interpreter) {
    if (stage.startsWith("interpreted_")) {
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
  } else if (is_broker) {
    if (message.status === "error") {
      result = {
        log: message,
        outbox: {
          ...message,
          stage: "interpreter_ai",
          status: "sent",
          meta: {
            ...(message.meta ?? {}),
            error_iteration: (message.meta as any)?.error_iteration ?? 1,
          },
        },
      };
    } else {
      result = { log: message };
    }
  } else if (sender === "rules_lawyer" && stage.startsWith("ruling_") && message.status === "pending_state_apply") {
    result = {
      log: message,
      outbox: {
        ...message,
        status: "pending_state_apply",
      },
    };
  } else if (is_state_applier && stage.startsWith("applied_")) {
    result = {
      log: message,
      outbox: {
        ...message,
        status: "sent",
      },
    };
  } else if (is_renderer && stage.startsWith("rendered_")) {
    result = { log: message };
  } else if (stage.startsWith("npc_response")) {
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
      outboxStatus: result.outbox?.status,
    });
  }

  return result;
}
