export type EngineLaunchAppId = 'ascii_painter' | 'game';

export type LaunchActionId = 'resume' | 'new' | 'load' | 'join';

export type LaunchActionAvailability =
  | { enabled: true }
  | { enabled: false; reason: string };

export type ResumeCandidate = {
  app_id: EngineLaunchAppId;
  slot: number;
  source:
    | { kind: 'file'; path: string }
    | { kind: 'session'; reconnect_token: string; host_boot_id?: string | null };
  summary: {
    title: string;
    subtitle?: string;
    updated_at_ms?: number | null;
  };
};

export type LaunchJoinEntry = {
  id: string;
  label: string;
  description?: string;
  local?: boolean;
  metadata?: Record<string, unknown>;
};

export type LaunchMenuState = {
  selected_action: LaunchActionId;
  availability: Record<LaunchActionId, LaunchActionAvailability>;
  resume_candidate: ResumeCandidate | null;
  join_entries: readonly LaunchJoinEntry[];
  status_lines: string[];
  is_busy: boolean;
  validation_state: 'idle' | 'loading' | 'ready' | 'error';
};

export type PersistedLaunchRecordV1 = {
  version: 1;
  app_id: EngineLaunchAppId;
  slot: number;
  last_action: LaunchActionId | null;
  last_updated_at_ms: number;
  resume_candidate: null | {
    kind: 'file' | 'session';
    file_path?: string;
    reconnect_token?: string;
    host_boot_id?: string | null;
    title?: string;
    updated_at_ms?: number | null;
  };
};

export type ResumeValidationResult<TLaunchIntent> =
  | { resumable: true; candidate: ResumeCandidate; resolved_intent: TLaunchIntent }
  | { resumable: false; reason: string };
