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
        return { log: message };
    }

    return { log: message };
}
