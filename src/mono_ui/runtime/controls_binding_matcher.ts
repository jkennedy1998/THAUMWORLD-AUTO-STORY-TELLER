import type { ControlBinding } from './controls_registry.js';

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
  return `Wheel ${binding.direction}`;
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

export function make_wheel_binding(direction: 'up' | 'down' | 'left' | 'right', mods?: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean }): ControlBinding {
  return { kind: 'wheel', direction, ctrl: Boolean(mods?.ctrl), shift: Boolean(mods?.shift), alt: Boolean(mods?.alt), meta: Boolean(mods?.meta) };
}
