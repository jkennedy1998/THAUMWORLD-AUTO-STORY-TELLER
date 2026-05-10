import { read_slot_json_file, write_slot_json_file } from '../../engine_persistence/slot_json_store.js';
import type { ProfileScope } from '../../user_profiles/profile_scope.js';
import { INDEXED_COLORS, set_active_indexed_colors, type IndexedColor } from '../colors.js';
import type { Rgb } from '../types.js';

export type IndexedPaletteEntry = {
  id: string;
  rgb: Rgb;
  label?: string;
};

export type IndexedPaletteState = {
  version: 1;
  entries: IndexedPaletteEntry[];
};

type IndexedPaletteFile = IndexedPaletteState;

const INDEXED_PALETTE_FILE_NAME = 'indexed_palette.json';

let current_indexed_palette_state: IndexedPaletteState = build_default_indexed_palette_state();

function clone_rgb(rgb: Rgb): Rgb {
  return { r: rgb.r, g: rgb.g, b: rgb.b };
}

function clone_entry(entry: IndexedPaletteEntry): IndexedPaletteEntry {
  return { id: entry.id, rgb: clone_rgb(entry.rgb), label: entry.label };
}

function sanitize_rgb(value: unknown, fallback: Rgb): Rgb {
  const candidate = value as Partial<Rgb> | null | undefined;
  return {
    r: Number.isFinite(candidate?.r) ? Math.max(0, Math.min(255, Math.round(candidate!.r as number))) : fallback.r,
    g: Number.isFinite(candidate?.g) ? Math.max(0, Math.min(255, Math.round(candidate!.g as number))) : fallback.g,
    b: Number.isFinite(candidate?.b) ? Math.max(0, Math.min(255, Math.round(candidate!.b as number))) : fallback.b,
  };
}

function sanitize_label(value: unknown, fallback: string): string {
  const label = String(value ?? '').trim();
  return label || fallback;
}

function rgb_to_hex(rgb: Rgb): string {
  return `#${rgb.r.toString(16).padStart(2, '0')}${rgb.g.toString(16).padStart(2, '0')}${rgb.b.toString(16).padStart(2, '0')}`;
}

function sync_active_palette_colors(state: IndexedPaletteState): void {
  const colors: IndexedColor[] = state.entries.map((entry, index) => ({
    id: entry.id,
    index,
    name: sanitize_label(entry.label, `COLOR ${index + 1}`),
    hex: rgb_to_hex(entry.rgb),
    rgb: clone_rgb(entry.rgb),
  }));
  set_active_indexed_colors(colors);
}

function sanitize_entries(source: unknown, defaults: IndexedPaletteEntry[]): IndexedPaletteEntry[] {
  const raw_entries = Array.isArray(source) ? source : [];
  const entries = raw_entries.map((entry, index) => {
    const candidate = entry && typeof entry === 'object' ? entry as Partial<IndexedPaletteEntry> : {};
    const fallback = defaults[Math.min(index, defaults.length - 1)] ?? defaults[0]!;
    return {
      id: String(candidate.id ?? `indexed_${index}`).trim() || `indexed_${index}`,
      rgb: sanitize_rgb(candidate.rgb, fallback.rgb),
      label: sanitize_label(candidate.label, fallback.label ?? `COLOR ${index + 1}`),
    };
  }).filter((entry, index, list) => list.findIndex((other) => other.id === entry.id) === index);
  return entries.length > 0 ? entries : defaults.map(clone_entry);
}

function sanitize_indexed_palette_file(raw: unknown, defaults: IndexedPaletteState): IndexedPaletteState {
  const source = raw && typeof raw === 'object' ? raw as Partial<IndexedPaletteFile> : {};
  return {
    version: 1,
    entries: sanitize_entries(source.entries, defaults.entries),
  };
}

export function build_default_indexed_palette_state(): IndexedPaletteState {
  return {
    version: 1,
    entries: INDEXED_COLORS.map((color, index) => ({
      id: `indexed_${index}`,
      rgb: clone_rgb(color.rgb),
      label: color.name,
    })),
  };
}

export function get_indexed_palette_state(): IndexedPaletteState {
  return {
    version: 1,
    entries: current_indexed_palette_state.entries.map(clone_entry),
  };
}

export function set_indexed_palette_state(next: IndexedPaletteState): IndexedPaletteState {
  current_indexed_palette_state = sanitize_indexed_palette_file(next, build_default_indexed_palette_state());
  sync_active_palette_colors(current_indexed_palette_state);
  return get_indexed_palette_state();
}

export function reset_indexed_palette_state(): IndexedPaletteState {
  return set_indexed_palette_state(build_default_indexed_palette_state());
}

export function update_indexed_palette_entry_rgb(entry_id: string, rgb: Rgb): IndexedPaletteState {
  const next = get_indexed_palette_state();
  const entry = next.entries.find((item) => item.id === entry_id);
  if (!entry) return next;
  entry.rgb = sanitize_rgb(rgb, entry.rgb);
  return set_indexed_palette_state(next);
}

export function reorder_indexed_palette_entries(next_ids: string[]): IndexedPaletteState {
  const current = get_indexed_palette_state();
  const by_id = new Map(current.entries.map((entry) => [entry.id, entry]));
  const ordered: IndexedPaletteEntry[] = [];
  for (const id of next_ids) {
    const found = by_id.get(id);
    if (found) {
      ordered.push(clone_entry(found));
      by_id.delete(id);
    }
  }
  for (const entry of current.entries) {
    if (by_id.has(entry.id)) ordered.push(clone_entry(entry));
  }
  return set_indexed_palette_state({ version: 1, entries: ordered });
}

export function duplicate_indexed_palette_entry(entry_id: string): IndexedPaletteState {
  const current = get_indexed_palette_state();
  const source_index = current.entries.findIndex((entry) => entry.id === entry_id);
  if (source_index < 0) return current;
  const source = current.entries[source_index]!;
  const duplicate: IndexedPaletteEntry = {
    id: `${source.id}_copy_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    rgb: clone_rgb(source.rgb),
    label: source.label,
  };
  current.entries.splice(source_index + 1, 0, duplicate);
  return set_indexed_palette_state(current);
}

export function delete_indexed_palette_entry(entry_id: string): IndexedPaletteState {
  const current = get_indexed_palette_state();
  if (current.entries.length <= 1) return current;
  const next_entries = current.entries.filter((entry) => entry.id !== entry_id);
  return set_indexed_palette_state({ version: 1, entries: next_entries });
}

export async function load_indexed_palette_state(slot: number, profile_scope?: ProfileScope | null): Promise<IndexedPaletteState> {
  const defaults = build_default_indexed_palette_state();
  const response = await read_slot_json_file<IndexedPaletteFile>(slot, profile_scope?.files.indexed_palette ?? INDEXED_PALETTE_FILE_NAME);
  if (!response.data) {
    current_indexed_palette_state = defaults;
    sync_active_palette_colors(current_indexed_palette_state);
    await write_slot_json_file(slot, profile_scope?.files.indexed_palette ?? INDEXED_PALETTE_FILE_NAME, current_indexed_palette_state).catch(() => null);
    return get_indexed_palette_state();
  }
  current_indexed_palette_state = sanitize_indexed_palette_file(response.data, defaults);
  sync_active_palette_colors(current_indexed_palette_state);
  return get_indexed_palette_state();
}

export async function save_indexed_palette_state(slot: number, next: IndexedPaletteState, profile_scope?: ProfileScope | null): Promise<IndexedPaletteState> {
  const sanitized = set_indexed_palette_state(next);
  await write_slot_json_file(slot, profile_scope?.files.indexed_palette ?? INDEXED_PALETTE_FILE_NAME, sanitized);
  return sanitized;
}
