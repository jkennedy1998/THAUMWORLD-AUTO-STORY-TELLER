import type { AutomationClockMode, AutomationClockSample } from './automation_clock_types.js';

type ScheduledAction = { at_breath: number };

type SchedulerState = 'waiting_start_delay' | 'waiting_for_origin' | 'running' | 'completed';

export function create_automation_timeline_scheduler(options: {
  clock_mode: AutomationClockMode;
  actions: ScheduledAction[];
  start_delay_ms: number;
  end_delay_ms: number;
}) {
  let state: SchedulerState = 'waiting_start_delay';
  let origin_position: number | null = null;
  let next_action_index = 0;

  function get_state(): SchedulerState {
    return state;
  }

  function get_origin_position(): number | null {
    return origin_position;
  }

  function get_next_action_index(): number {
    return next_action_index;
  }

  function arm_after_start_delay(clock_sample: AutomationClockSample): { state_changed: boolean; origin_established: boolean } {
    if (state !== 'waiting_start_delay') return { state_changed: false, origin_established: origin_position !== null };
    if (options.clock_mode === 'realtime_ms') {
      origin_position = clock_sample.position;
      state = 'running';
      return { state_changed: true, origin_established: true };
    }
    state = 'waiting_for_origin';
    return { state_changed: true, origin_established: false };
  }

  function update_from_clock(clock_sample: AutomationClockSample): { origin_established: boolean; due_action_indexes: number[] } {
    if (state === 'waiting_for_origin' && clock_sample.ready) {
      origin_position = clock_sample.position;
      state = 'running';
    }
    if (state !== 'running' || origin_position === null) {
      return { origin_established: false, due_action_indexes: [] };
    }
    const relative_position = clock_sample.position - origin_position;
    const due_action_indexes: number[] = [];
    while (next_action_index < options.actions.length) {
      const action = options.actions[next_action_index]!;
      if (relative_position < action.at_breath) break;
      due_action_indexes.push(next_action_index);
      next_action_index += 1;
    }
    return { origin_established: true, due_action_indexes };
  }

  function get_action_target_position(action: ScheduledAction): number | null {
    return origin_position === null ? null : origin_position + action.at_breath;
  }

  function has_completed_actions(): boolean {
    return next_action_index >= options.actions.length;
  }

  function mark_completed(): void {
    state = 'completed';
  }

  return {
    clock_mode: options.clock_mode,
    start_delay_ms: options.start_delay_ms,
    end_delay_ms: options.end_delay_ms,
    get_state,
    get_origin_position,
    get_next_action_index,
    arm_after_start_delay,
    update_from_clock,
    get_action_target_position,
    has_completed_actions,
    mark_completed,
  };
}
