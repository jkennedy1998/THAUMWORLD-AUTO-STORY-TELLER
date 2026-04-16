import type { AutomationClockSample, AutomationClockSource } from './automation_clock_types.js';

export function create_place_breath_clock_source(): AutomationClockSource & {
  notify_tick: (tick_index: number, meta?: Record<string, unknown>) => void;
} {
  const listeners = new Set<(sample: AutomationClockSample) => void>();
  let last_sample: AutomationClockSample = {
    mode: 'breath',
    position: 0,
    ready: false,
    source: 'place_breath_clock',
  };
  return {
    mode: 'breath',
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get_snapshot() {
      return last_sample;
    },
    notify_tick(tick_index, meta) {
      last_sample = {
        mode: 'breath',
        position: tick_index,
        ready: true,
        source: 'place_breath_clock',
        meta,
      };
      for (const listener of listeners) {
        try {
          listener(last_sample);
        } catch {
          // ignore
        }
      }
    },
  };
}
