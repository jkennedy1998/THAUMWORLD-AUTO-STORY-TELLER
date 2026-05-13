import type * as http from "node:http";
import {
  readInterfaceHealth,
  readSessionHealth,
  readSessionLog,
  readSessionStatus,
  type SessionHealthServiceDeps,
} from "./service.js";

function writeJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function parseSlot(slotRaw: string | null, defaultSlot: number): number {
  return slotRaw ? Number(slotRaw) : defaultSlot;
}

export function handleSessionHealthRoute(args: {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  data_slot_number: number;
  deps: SessionHealthServiceDeps;
}): boolean {
  const { req, res, data_slot_number, deps } = args;
  const url = new URL(req.url || "/", "http://localhost");

  if (url.pathname === "/api/log") {
    if (req.method !== "GET") {
      writeJson(res, 405, { ok: false, error: "method_not_allowed" });
      return true;
    }

    const slot = parseSlot(url.searchParams.get("slot"), data_slot_number);
    if (!Number.isFinite(slot) || slot <= 0) {
      writeJson(res, 400, { ok: false, error: "invalid_slot" });
      return true;
    }

    try {
      const include_all_messages = url.searchParams.get("all") === "1";
      writeJson(res, 200, readSessionLog({ slot, include_all_messages, deps }));
    } catch (err: any) {
      writeJson(res, 500, { ok: false, error: err?.message ?? "read_failed" });
    }
    return true;
  }

  if (url.pathname === "/api/status") {
    if (req.method !== "GET") {
      writeJson(res, 405, { ok: false, error: "method_not_allowed" });
      return true;
    }

    const slot = parseSlot(url.searchParams.get("slot"), data_slot_number);
    if (!Number.isFinite(slot) || slot <= 0) {
      writeJson(res, 400, { ok: false, error: "invalid_slot" });
      return true;
    }

    try {
      writeJson(res, 200, readSessionStatus({ slot, deps }));
    } catch (err: any) {
      writeJson(res, 500, { ok: false, error: err?.message ?? "read_failed" });
    }
    return true;
  }

  if (url.pathname === "/api/health") {
    if (req.method !== "GET") {
      writeJson(res, 405, { ok: false, error: "method_not_allowed" });
      return true;
    }

    try {
      writeJson(res, 200, readInterfaceHealth({ slot: data_slot_number, deps }));
    } catch (err: any) {
      writeJson(res, 500, { ok: false, error: err?.message ?? "health_check_failed" });
    }
    return true;
  }

  if (url.pathname === "/api/health/session") {
    if (req.method !== "GET") {
      writeJson(res, 405, { ok: false, error: "method_not_allowed" });
      return true;
    }

    try {
      writeJson(res, 200, readSessionHealth({ deps }));
    } catch (err: any) {
      writeJson(res, 500, { ok: false, error: err?.message ?? "session_check_failed" });
    }
    return true;
  }

  return false;
}
