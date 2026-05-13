import type { GameTime } from "../../time_system/tracker.js";

export interface SessionHealthServiceDeps {
  read_log: (logPath: string) => { messages: any[] };
  read_status: (statusPath: string) => unknown;
  load_time: (slot: number) => GameTime | null;
  format_short_time: (time: GameTime) => string;
  get_log_path: (slot: number) => string;
  get_status_path: (slot: number) => string;
  session_id: string;
  isCurrentSession: (message: any) => boolean;
}

export function readSessionLog(args: {
  slot: number;
  include_all_messages: boolean;
  deps: SessionHealthServiceDeps;
}): { ok: true; messages: any[] } {
  const { slot, include_all_messages, deps } = args;
  const log = deps.read_log(deps.get_log_path(slot));
  const messages = include_all_messages ? log.messages : log.messages.filter((message) => deps.isCurrentSession(message));
  return { ok: true, messages };
}

export function readSessionStatus(args: {
  slot: number;
  deps: SessionHealthServiceDeps;
}): {
  ok: true;
  status: unknown;
  game_time: GameTime | null;
  time_short: string | null;
  day: number | null;
} {
  const { slot, deps } = args;
  const status = deps.read_status(deps.get_status_path(slot));
  const time = deps.load_time(slot);
  return {
    ok: true,
    status,
    game_time: time,
    time_short: time ? deps.format_short_time(time) : null,
    day: time ? time.day : null,
  };
}

export function readInterfaceHealth(args: {
  slot: number;
  deps: SessionHealthServiceDeps;
}): {
  ok: true;
  status: "healthy";
  session_id: string;
  services: {
    interface_program: true;
    recent_activity: Record<string, number>;
    total_recent_messages: number;
  };
} {
  const { slot, deps } = args;
  const log = deps.read_log(deps.get_log_path(slot));
  const recentMessages = log.messages.slice(-10);
  const serviceActivity: Record<string, number> = {};

  for (const msg of recentMessages) {
    const sender = msg.sender?.toLowerCase() ?? "unknown";
    serviceActivity[sender] = (serviceActivity[sender] ?? 0) + 1;
  }

  return {
    ok: true,
    status: "healthy",
    session_id: deps.session_id,
    services: {
      interface_program: true,
      recent_activity: serviceActivity,
      total_recent_messages: recentMessages.length,
    },
  };
}

export function readSessionHealth(args: {
  deps: SessionHealthServiceDeps;
}): {
  ok: true;
  session_id: string;
  status: "session_active";
} {
  return {
    ok: true,
    session_id: args.deps.session_id,
    status: "session_active",
  };
}
