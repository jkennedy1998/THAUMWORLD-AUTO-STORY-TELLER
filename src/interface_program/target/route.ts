import type * as http from "node:http";
import { debug_log } from "../../shared/debug.js";
import { applyActorTargetSelection, type TargetSelectionType } from "./service.js";

function writeJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

export function handleTargetRoute(args: {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  data_slot_number: number;
  require_request_client_session_id: (
    dataSlot: number,
    auth: { session_token?: unknown; client_session_id?: unknown },
  ) => string;
  require_authorized_actor_ref: (
    dataSlot: number,
    client_session_id: string,
    requested_actor_ref?: unknown,
  ) => string;
}): boolean {
  const { req, res, data_slot_number, require_request_client_session_id, require_authorized_actor_ref } = args;
  const url = new URL(req.url || "/", "http://localhost");
  if (url.pathname !== "/api/target") return false;

  if (req.method !== "POST") {
    writeJson(res, 405, { ok: false, error: "method_not_allowed" });
    return true;
  }

  let body = "";
  req.on("data", (chunk: Buffer) => {
    body += chunk.toString();
  });
  req.on("end", () => {
    try {
      const data = JSON.parse(body);
      const client_session_id = require_request_client_session_id(data_slot_number, { session_token: data?.session_token });
      const actor_ref = require_authorized_actor_ref(data_slot_number, client_session_id, data?.actor_ref);
      const target_type = (data?.target_type || "npc") as TargetSelectionType;
      const target_name = typeof data?.target_name === "string" ? data.target_name : undefined;

      const result = applyActorTargetSelection({
        actor_ref,
        target_ref: data?.target_ref,
        target_type,
        target_name,
      });

      if (result.action === "set") {
        debug_log("[API]", `Target set for ${result.actor_ref}: ${result.target_ref} (${result.target_type})`);
      }

      writeJson(res, 200, result);
    } catch (err: any) {
      const error = err?.message ?? "invalid_request";
      const status = error === "actor_ref_not_authorized"
        ? 403
        : error === "invalid_session_token" || error === "controlled_actor_binding_required"
          ? 401
          : 500;
      writeJson(res, status, { ok: false, error });
    }
  });
  req.on("error", (err) => {
    const error = (err as Error | undefined)?.message ?? "invalid_request";
    writeJson(res, 500, { ok: false, error });
  });

  return true;
}
