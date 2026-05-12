import type { ControlBinding } from './controls_registry.js';
import type { WheelEvent } from '../types.js';

function getWheelEventDirection(e: WheelEvent): 'up' | 'down' | 'left' | 'right' | null {
  return Math.abs(e.delta_y) >= Math.abs(e.delta_x)
    ? (e.delta_y < 0 ? 'up' : e.delta_y > 0 ? 'down' : null)
    : (e.delta_x < 0 ? 'left' : e.delta_x > 0 ? 'right' : null);
}

function isModifierKeyCode(code: string): boolean {
  return code === 'ShiftLeft'
    || code === 'ShiftRight'
    || code === 'ControlLeft'
    || code === 'ControlRight'
    || code === 'AltLeft'
    || code === 'AltRight'
    || code === 'MetaLeft'
    || code === 'MetaRight';
}

function normalizeHeldKeys(keys: string[] | undefined): string[] {
  if (!Array.isArray(keys) || keys.length === 0) return [];
  return Array.from(new Set(keys.map((key) => String(key ?? '').trim()).filter((key) => key.length > 0 && !isModifierKeyCode(key)))).sort();
}

function wheel_binding_specificity(binding: Extract<ControlBinding, { kind: 'wheel' }>): number {
  return (binding.ctrl ? 1 : 0)
    + (binding.shift ? 1 : 0)
    + (binding.alt ? 1 : 0)
    + (binding.meta ? 1 : 0)
    + normalizeHeldKeys(binding.held_keys).length * 10;
}

export function format_control_binding(binding: ControlBinding | null): string {
  if (!binding) return 'UNBOUND';
  if (binding.kind === 'keyboard') {
    const parts: string[] = [];
    if (binding.ctrl) parts.push('Ctrl');
    if (binding.shift) parts.push('Shift');
    if (binding.alt) parts.push('Alt');
    if (binding.meta) parts.push('Meta');
    parts.push(binding.code);
    return parts.join('+');
  }
  if (binding.kind === 'pointer_button') return binding.button === 'primary' ? 'Primary Click' : binding.button === 'secondary' ? 'Secondary Click' : 'Aux Click';
  if (binding.kind === 'pointer_gesture') return binding.gesture;
  const parts: string[] = [];
  if (binding.ctrl) parts.push('Ctrl');
  if (binding.shift) parts.push('Shift');
  if (binding.alt) parts.push('Alt');
  if (binding.meta) parts.push('Meta');
  parts.push(...normalizeHeldKeys(binding.held_keys));
  parts.push(`Wheel ${binding.direction}`);
  return parts.join('+');
}

export function control_binding_conflict_key(binding: ControlBinding | null): string | null {
  if (!binding) return null;
  return JSON.stringify(binding);
}

export function control_binding_matches_keyboard_event(binding: ControlBinding | null, e: KeyboardEvent): boolean {
  if (!binding || binding.kind !== 'keyboard') return false;
  return binding.code === e.code
    && Boolean(binding.ctrl) === Boolean(e.ctrlKey || e.metaKey && binding.ctrl)
    && Boolean(binding.shift) === Boolean(e.shiftKey)
    && Boolean(binding.alt) === Boolean(e.altKey)
    && Boolean(binding.meta) === Boolean(e.metaKey);
}

export function control_binding_matches_wheel_event(binding: ControlBinding | null, e: WheelEvent): boolean {
  if (!binding || binding.kind !== 'wheel') return false;
  const dominantDirection = getWheelEventDirection(e);
  if (!dominantDirection) return false;
  const requiredHeldKeys = normalizeHeldKeys(binding.held_keys);
  const actualHeldKeys = new Set(normalizeHeldKeys(e.held_keys));
  return binding.direction === dominantDirection
    && Boolean(binding.ctrl) === Boolean(e.ctrl)
    && Boolean(binding.shift) === Boolean(e.shift)
    && Boolean(binding.alt) === Boolean(e.alt)
    && Boolean(binding.meta) === Boolean(e.meta)
    && requiredHeldKeys.every((key) => actualHeldKeys.has(key));
}

export function resolve_wheel_binding_action(action_ids: string[], get_binding: (action_id: string) => ControlBinding | null, e: WheelEvent): string | null {
  let bestActionId: string | null = null;
  let bestSpecificity = -1;
  for (const action_id of action_ids) {
    const binding = get_binding(action_id);
    if (!binding || binding.kind !== 'wheel') continue;
    if (!control_binding_matches_wheel_event(binding, e)) continue;
    const specificity = wheel_binding_specificity(binding);
    if (specificity < bestSpecificity) continue;
    if (specificity === bestSpecificity && bestActionId !== null) continue;
    bestSpecificity = specificity;
    bestActionId = action_id;
  }
  return bestActionId;
}

export function make_keyboard_binding_from_event(e: KeyboardEvent): ControlBinding | null {
  if (!e.code) return null;
  return {
    kind: 'keyboard',
    code: e.code,
    ctrl: Boolean(e.ctrlKey),
    shift: Boolean(e.shiftKey),
    alt: Boolean(e.altKey),
    meta: Boolean(e.metaKey),
  };
}

export function make_pointer_button_binding(button: number): ControlBinding | null {
  if (button === 2) return { kind: 'pointer_button', button: 'secondary' };
  if (button === 1) return { kind: 'pointer_button', button: 'auxiliary' };
  if (button === 0) return { kind: 'pointer_button', button: 'primary' };
  return null;
}

export function make_wheel_binding(direction: 'up' | 'down' | 'left' | 'right', mods?: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean; held_keys?: string[] }): ControlBinding {
  return {
    kind: 'wheel',
    direction,
    ctrl: Boolean(mods?.ctrl),
    shift: Boolean(mods?.shift),
    alt: Boolean(mods?.alt),
    meta: Boolean(mods?.meta),
    held_keys: normalizeHeldKeys(mods?.held_keys),
  };
}
