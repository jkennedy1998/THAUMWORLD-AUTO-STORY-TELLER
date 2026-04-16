import type { AutomationClockSample, AutomationClockSource } from './automation_clock_types.js';

export function create_realtime_clock_source(): AutomationClockSource & {
  start: () => void;
  stop: () => void;
} {
  let listeners = new Set<(sample: AutomationClockSample) => void>();
  let timer_id: number | null = null;

  const build_sample = (): AutomationClockSample => ({
    mode: 'realtime_ms',
    position: Math.max(0, Math.floor(performance.now())),
    ready: true,
    source: 'realtime_clock',
  });

  const notify = (): void => {
    const sample = build_sample();
    for (const listener of listeners) {
      try {
        listener(sample);
      } catch {
        // ignore
      }
    }
  };

  return {
    mode: 'realtime_ms',
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get_snapshot() {
      return build_sample();
    },
    start() {
      if (timer_id !== null) return;
      timer_id = window.setInterval(() => {
        notify();
      }, 16);
      notify();
    },
    stop() {
      if (timer_id !== null) {
        window.clearInterval(timer_id);
        timer_id = null;
      }
    },
  };
}
