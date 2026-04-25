import type { DragPayload } from './interaction_payload_runtime.js';
import type { InteractionHoverState, InteractionSession } from './interaction_session_runtime.js';
import type { OrderedResolvedTargets, ResolvedTarget } from './interaction_target_runtime.js';
import type { ViewInstance } from './interaction_view_runtime.js';

export type ViewRegistrationAdapter = {
  get_view_instances: () => readonly ViewInstance[];
};

export type ResolutionAdapterInput = {
  module_id: string;
  view_id: string;
  pointer: {
    x: number;
    y: number;
    pointer_id?: number;
    button?: number;
    buttons?: number;
    shift?: boolean;
    ctrl?: boolean;
    alt?: boolean;
    meta?: boolean;
  };
};

export type ResolutionAdapter = {
  resolve_targets: (input: ResolutionAdapterInput) => OrderedResolvedTargets;
};

export type InteractionSessionHandler = {
  begin_interaction?: (session: InteractionSession) => void;
  update_interaction?: (session: InteractionSession) => void;
  end_interaction?: (session: InteractionSession) => void;
  cancel_interaction?: (session: InteractionSession) => void;
  update_hover?: (hover: InteractionHoverState) => void;
};

export type PayloadCompatibilityResult = {
  considered: boolean;
  accepted: boolean;
  highlight_kind?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
};

export type PayloadCompatibilityAdapter = {
  evaluate_payload_for_target: (payload: DragPayload, target: ResolvedTarget) => PayloadCompatibilityResult | Promise<PayloadCompatibilityResult>;
};

export type ConsumerCommitAdapter = {
  commit_interaction?: (session: InteractionSession) => void | Promise<void>;
};

export type InteractionConsumerAdapters = {
  view_registration: ViewRegistrationAdapter;
  resolution?: ResolutionAdapter;
  session_handler?: InteractionSessionHandler;
  payload_compatibility?: PayloadCompatibilityAdapter;
  consumer_commit?: ConsumerCommitAdapter;
};
