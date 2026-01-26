import type { MessageEnvelope } from "./types.js";
import { try_set_message_status } from "./message.js";

export type RouteResult = {
    log: MessageEnvelope;
    outbox?: MessageEnvelope;
};

export function route_message(message: MessageEnvelope): RouteResult {
    const sender = message.sender.toLowerCase();
    const type = (message.type ?? "").toLowerCase();

    const is_user = sender === "j" || sender === "user" || type === "user_input";
    const is_interpreter = sender === "interpreter_ai" || type === "interpreter_ai";
    const is_broker = sender === "data_broker" || type === "data_broker";

    if (is_user) {
        const { message: sent } = try_set_message_status(message, 'sent');
        return {
            log: sent,
            outbox: {
                ...sent,
                stage: sent.stage ?? "interpreter_ai",
            },
        };
    }

    if (is_interpreter) {
        if (message.stage?.startsWith("interpreted_")) {
            return {
                log: message,
                outbox: {
                    ...message,
                    status: "sent",
                },
            };
        }
        return { log: message };
    }

    if (is_broker) {
        if (message.status === "error") {
            return {
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
        }
        return { log: message };
    }

    return { log: message };
}
