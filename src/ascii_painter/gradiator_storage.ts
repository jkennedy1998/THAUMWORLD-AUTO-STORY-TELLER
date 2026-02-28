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
  DEFAULT_GRADIATOR_3 
} from './gradiator.js';

const STORAGE_KEY = 'painter_gradiators';

export type GradiatorStorageData = {
  slots: string[];
  activeSlot: number;
};

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
      const parsed = JSON.parse(data) as GradiatorStorageData;
      // Validate data
      if (parsed.slots && parsed.slots.length === 3 && 
          typeof parsed.activeSlot === 'number' && 
          parsed.activeSlot >= 0 && parsed.activeSlot <= 2) {
        const state = createGradiatorState();
        const defaults = [DEFAULT_GRADIATOR_1, DEFAULT_GRADIATOR_2, DEFAULT_GRADIATOR_3];
        state.slots = parsed.slots.map((s, i) => (s && s.length > 0) ? s : defaults[i]!);
        setActiveGradiatorSlot(state, parsed.activeSlot as GradiatorSlot);
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
