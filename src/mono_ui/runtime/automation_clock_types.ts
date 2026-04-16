export type AutomationClockMode = 'breath' | 'realtime_ms';

export type AutomationClockSample = {
  mode: AutomationClockMode;
  position: number;
  ready: boolean;
  source: string;
  meta?: Record<string, unknown>;
};

export interface AutomationClockSource {
  readonly mode: AutomationClockMode;
  subscribe(listener: (sample: AutomationClockSample) => void): () => void;
  get_snapshot(): AutomationClockSample;
}
