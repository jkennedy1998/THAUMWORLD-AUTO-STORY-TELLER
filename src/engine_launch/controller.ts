import type { Module, Rect } from '../mono_ui/types.js';
import { make_launch_module } from '../mono_ui/modules/launch_module.js';
import type { LaunchActionAvailability, LaunchActionId, LaunchJoinEntry, LaunchMenuState, ResumeCandidate, ResumeValidationResult } from './types.js';

export type LaunchAdapter<TLaunchIntent> = {
  title: string;
  initial_status_lines?: string[];
  validate_resume: () => Promise<ResumeValidationResult<TLaunchIntent>>;
  create_new_intent: () => Promise<TLaunchIntent | null>;
  create_load_intent: () => Promise<TLaunchIntent | null>;
  create_join_intent?: (entry: LaunchJoinEntry | null) => Promise<TLaunchIntent | null>;
  get_join_entries?: () => Promise<LaunchJoinEntry[]>;
};

export function create_launch_controller<TLaunchIntent>(args: {
  id: string;
  rect: Rect;
  adapter: LaunchAdapter<TLaunchIntent>;
  on_launch_intent: (intent: TLaunchIntent) => Promise<void> | void;
  on_join_requested?: () => Promise<void> | void;
}): {
  modules: readonly Module[];
  refresh: () => Promise<void>;
  get_state: () => LaunchMenuState;
} {
  let resume_candidate: ResumeCandidate | null = null;
  let resolved_resume_intent: TLaunchIntent | null = null;
  let join_entries: readonly LaunchJoinEntry[] = [];
  let selected_join_entry_id: string | null = null;
  let state: LaunchMenuState = {
    selected_action: 'resume',
    selected_join_entry_id: null,
    availability: {
      resume: { enabled: false, reason: 'Checking...' },
      new: { enabled: true },
      load: { enabled: true },
      join: { enabled: false, reason: 'Not yet implemented' },
    },
    resume_candidate: null,
    join_entries: [],
    status_lines: args.adapter.initial_status_lines ?? ['Choose how to begin'],
    is_busy: false,
    validation_state: 'idle',
  };

  function set_action_availability(action: LaunchActionId, availability: LaunchActionAvailability): void {
    state = {
      ...state,
      availability: {
        ...state.availability,
        [action]: availability,
      },
    };
  }

  async function refresh(): Promise<void> {
    state = { ...state, validation_state: 'loading', status_lines: ['Validating resume...'] };
    const result = await args.adapter.validate_resume();
    if (result.resumable) {
      resume_candidate = result.candidate;
      resolved_resume_intent = result.resolved_intent;
      set_action_availability('resume', { enabled: true });
    } else {
      resume_candidate = null;
      resolved_resume_intent = null;
      set_action_availability('resume', { enabled: false, reason: result.reason });
    }
    join_entries = args.adapter.get_join_entries ? await args.adapter.get_join_entries() : [];
    selected_join_entry_id = selected_join_entry_id && join_entries.some((entry) => entry.id === selected_join_entry_id)
      ? selected_join_entry_id
      : (join_entries[0]?.id ?? null);
    const selected_join_entry = join_entries.find((entry) => entry.id === selected_join_entry_id) ?? null;
    set_action_availability('join', args.on_join_requested
      ? { enabled: true }
      : args.adapter.create_join_intent
        ? (join_entries.length > 0 ? { enabled: true } : { enabled: false, reason: 'No joinable session available' })
        : { enabled: false, reason: 'Not yet implemented' });
    state = {
      ...state,
      validation_state: 'ready',
      selected_join_entry_id,
      resume_candidate,
      join_entries,
      status_lines: resume_candidate
        ? ['Resume is available', resume_candidate.summary.title]
        : selected_join_entry
          ? ['Join target available', selected_join_entry.description ?? selected_join_entry.label]
        : args.adapter.initial_status_lines ?? ['Choose how to begin'],
    };
  }

  async function confirm(action: LaunchActionId): Promise<void> {
    const availability = state.availability[action];
    if (!availability.enabled || state.is_busy) return;
    state = { ...state, is_busy: true, status_lines: [`Starting ${action}...`] };
    try {
      let intent: TLaunchIntent | null = null;
      if (action === 'resume') intent = resolved_resume_intent;
      else if (action === 'new') intent = await args.adapter.create_new_intent();
      else if (action === 'load') intent = await args.adapter.create_load_intent();
      else if (action === 'join') {
        if (args.on_join_requested) {
          await args.on_join_requested();
          state = { ...state, is_busy: false };
          return;
        }
        const selected_join_entry = join_entries.find((entry) => entry.id === selected_join_entry_id) ?? null;
        intent = args.adapter.create_join_intent ? await args.adapter.create_join_intent(selected_join_entry) : null;
      }
      if (!intent) {
        state = { ...state, is_busy: false, status_lines: ['Action cancelled'] };
        return;
      }
      await args.on_launch_intent(intent);
    } finally {
      state = { ...state, is_busy: false };
    }
  }

  const module = make_launch_module({
    id: args.id,
    rect: args.rect,
    title: args.adapter.title,
    get_state: () => state,
    on_select_action: (action) => {
      state = { ...state, selected_action: action };
    },
    on_select_join_entry: (entry_id: string) => {
      selected_join_entry_id = entry_id;
      const selected_join_entry = join_entries.find((entry) => entry.id === entry_id) ?? null;
      state = {
        ...state,
        selected_join_entry_id,
        status_lines: selected_join_entry
          ? ['Join target selected', selected_join_entry.description ?? selected_join_entry.label]
          : state.status_lines,
      };
    },
    on_confirm_action: (action) => {
      void confirm(action);
    },
  });

  return {
    modules: [module],
    refresh,
    get_state: () => state,
  };
}
