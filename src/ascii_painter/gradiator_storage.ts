/**
 * Gradiator Storage
 * 
 * Handles saving and loading gradiator configurations to localStorage.
 */

import type { GradiatorState, GradiatorSlot } from './gradiator.js';
import { 
  createGradiatorState, 
  setActiveGradiatorSlot, 
  DEFAULT_GRADIATOR_1, 
  DEFAULT_GRADIATOR_2, 
  DEFAULT_GRADIATOR_3,
  MAX_GRADIATOR_WIDTH,
  MIN_GRADIATOR_WIDTH,
  NUM_GRADIATOR_SLOTS,
} from './gradiator.js';

const STORAGE_KEY = 'painter_gradiators';

export type GradiatorStorageData = {
  slots: string[];
  activeSlot: number;
};

const DEFAULT_GRADIATOR_SLOTS = [DEFAULT_GRADIATOR_1, DEFAULT_GRADIATOR_2, DEFAULT_GRADIATOR_3] as const;

function sanitize_gradiator_slot(slot: unknown, slot_index: number): { value: string; changed: boolean } {
  const fallback = DEFAULT_GRADIATOR_SLOTS[slot_index] ?? DEFAULT_GRADIATOR_1;
  if (typeof slot !== 'string') return { value: fallback, changed: true };
  const normalized = slot.slice(0, MAX_GRADIATOR_WIDTH);
  if (normalized.length < MIN_GRADIATOR_WIDTH) return { value: fallback, changed: true };
  if (normalized !== slot) return { value: normalized, changed: true };
  return { value: normalized, changed: false };
}

function sanitize_gradiator_storage_data(parsed: unknown): { slots: string[]; activeSlot: GradiatorSlot; changed: boolean } | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const maybe = parsed as Partial<GradiatorStorageData>;
  const raw_slots = Array.isArray(maybe.slots) ? maybe.slots : null;
  if (!raw_slots) return null;

  let changed = raw_slots.length !== NUM_GRADIATOR_SLOTS;
  const slots: string[] = [];
  for (let i = 0; i < NUM_GRADIATOR_SLOTS; i += 1) {
    const sanitized = sanitize_gradiator_slot(raw_slots[i], i);
    slots.push(sanitized.value);
    changed = changed || sanitized.changed;
  }

  const raw_active = typeof maybe.activeSlot === 'number' ? Math.trunc(maybe.activeSlot) : 0;
  const activeSlot = Math.max(0, Math.min(NUM_GRADIATOR_SLOTS - 1, raw_active)) as GradiatorSlot;
  changed = changed || raw_active !== activeSlot;

  return { slots, activeSlot, changed };
}

/**
 * Save gradiator state to localStorage
 */
export function saveGradiatorState(state: GradiatorState): void {
  try {
    const data: GradiatorStorageData = {
      slots: [...state.slots],
      activeSlot: state.activeSlot
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('Failed to save gradiator state:', e);
  }
}

/**
 * Load gradiator state from localStorage
 */
export function loadGradiatorState(): GradiatorState {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (data) {
      const sanitized = sanitize_gradiator_storage_data(JSON.parse(data));
      if (sanitized) {
        const state = createGradiatorState();
        state.slots = sanitized.slots;
        setActiveGradiatorSlot(state, sanitized.activeSlot);
        if (sanitized.changed) saveGradiatorState(state);
        return state;
      }
    }
  } catch (e) {
    console.warn('Failed to load gradiator state:', e);
  }
  // Return default state if loading fails
  return createGradiatorState();
}

/**
 * Clear saved gradiator state
 */
export function clearGradiatorState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.warn('Failed to clear gradiator state:', e);
  }
}
