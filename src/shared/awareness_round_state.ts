import { get_timed_event_state } from "../world_storage/store.js";

type AwarenessEvidence = {
  observer_ref: string;
  target_ref: string;
  cycle_id: string;
  identity_known: boolean;
  location_known: boolean;
  position?: {
    x: number;
    y: number;
    z?: number;
    place_id?: string;
  };
  best_sense?: string;
  updated_at: number;
};

const evidence_by_pair = new Map<string, AwarenessEvidence>();
const REALTIME_CYCLE_MS = 6000;

function make_key(observer_ref: string, target_ref: string): string {
  return `${observer_ref}=>${target_ref}`;
}

export function get_awareness_cycle_id(slot: number): string {
  const timed = get_timed_event_state(slot);
  if (timed?.timed_event_active && timed?.event_id) {
    return `timed:${String(timed.event_id)}:round:${String(timed.current_round ?? 1)}`;
  }
  return `realtime:${Math.floor(Date.now() / REALTIME_CYCLE_MS)}`;
}

export function record_awareness_evidence(slot: number, evidence: Omit<AwarenessEvidence, "cycle_id" | "updated_at">): AwarenessEvidence {
  const cycle_id = get_awareness_cycle_id(slot);
  const key = make_key(evidence.observer_ref, evidence.target_ref);
  const next: AwarenessEvidence = {
    ...evidence,
    cycle_id,
    updated_at: Date.now(),
  };
  evidence_by_pair.set(key, next);
  return next;
}

export function get_awareness_evidence(slot: number, observer_ref: string, target_ref: string): AwarenessEvidence | null {
  const current = evidence_by_pair.get(make_key(observer_ref, target_ref));
  if (!current) return null;
  return current.cycle_id === get_awareness_cycle_id(slot) ? current : null;
}

export function has_awareness_evidence(slot: number, observer_ref: string, target_ref: string): boolean {
  return get_awareness_evidence(slot, observer_ref, target_ref) !== null;
}

export function prune_awareness_evidence(slot: number): void {
  const active_cycle = get_awareness_cycle_id(slot);
  for (const [key, value] of evidence_by_pair.entries()) {
    if (value.cycle_id !== active_cycle) {
      evidence_by_pair.delete(key);
    }
  }
}
