import { read_slot_relative_json_file, write_slot_relative_json_file } from '../engine_persistence/slot_json_store.js';
import type { CameraSettingsAppId } from '../mono_ui/runtime/camera_limits.js';
import { create_profile_scope, DEFAULT_NAMED_PROFILE_ID, type ProfileScope } from './profile_scope.js';

export type NamedProfileRecord = {
  profile_id: string;
  label: string;
  created_at: string;
  updated_at: string;
  linked_actor_id?: string | null;
  linked_actor_ref?: string | null;
};

export type NamedProfileIndexFile = {
  version: 1;
  profiles: NamedProfileRecord[];
  selected_profile_ids?: Partial<Record<CameraSettingsAppId | 'shared', string>>;
};

const NAMED_PROFILE_INDEX_FILE = 'profiles/index.json';

function normalize_profile_id(value: unknown): string {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return normalized || DEFAULT_NAMED_PROFILE_ID;
}

function sanitize_profile_record(value: unknown, fallback_now: string): NamedProfileRecord | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Partial<NamedProfileRecord>;
  const profile_id = normalize_profile_id(source.profile_id);
  const label = String(source.label ?? '').trim() || (profile_id === DEFAULT_NAMED_PROFILE_ID ? 'Default Profile' : profile_id);
  return {
    profile_id,
    label,
    created_at: String(source.created_at ?? '').trim() || fallback_now,
    updated_at: String(source.updated_at ?? '').trim() || fallback_now,
    linked_actor_id: source.linked_actor_id ? String(source.linked_actor_id).trim() || null : null,
    linked_actor_ref: source.linked_actor_ref ? String(source.linked_actor_ref).trim() || null : null,
  };
}

function build_default_index(now = new Date().toISOString()): NamedProfileIndexFile {
  return {
    version: 1,
    profiles: [{
      profile_id: DEFAULT_NAMED_PROFILE_ID,
      label: 'Default Profile',
      created_at: now,
      updated_at: now,
      linked_actor_id: null,
      linked_actor_ref: null,
    }],
    selected_profile_ids: {
      shared: DEFAULT_NAMED_PROFILE_ID,
      thaum_world: DEFAULT_NAMED_PROFILE_ID,
      thaum_painter: DEFAULT_NAMED_PROFILE_ID,
    },
  };
}

function sanitize_index(raw: unknown): NamedProfileIndexFile {
  const now = new Date().toISOString();
  const source = raw && typeof raw === 'object' ? raw as Partial<NamedProfileIndexFile> : {};
  const records = Array.isArray(source.profiles) ? source.profiles : [];
  const profiles: NamedProfileRecord[] = [];
  const seen = new Set<string>();
  for (const entry of records) {
    const record = sanitize_profile_record(entry, now);
    if (!record || seen.has(record.profile_id)) continue;
    seen.add(record.profile_id);
    profiles.push(record);
  }
  if (profiles.length < 1) {
    return build_default_index(now);
  }
  const raw_selected = source.selected_profile_ids && typeof source.selected_profile_ids === 'object'
    ? source.selected_profile_ids as Record<string, unknown>
    : {};
  const selected_profile_ids: Partial<Record<CameraSettingsAppId | 'shared', string>> = {};
  const choose = (key: CameraSettingsAppId | 'shared') => {
    const value = normalize_profile_id(raw_selected[key]);
    selected_profile_ids[key] = seen.has(value) ? value : profiles[0]!.profile_id;
  };
  choose('shared');
  choose('thaum_world');
  choose('thaum_painter');
  return {
    version: 1,
    profiles,
    selected_profile_ids,
  };
}

export async function load_named_profile_index(slot: number): Promise<NamedProfileIndexFile> {
  const response = await read_slot_relative_json_file<NamedProfileIndexFile>(slot, NAMED_PROFILE_INDEX_FILE);
  return response.data ? sanitize_index(response.data) : build_default_index();
}

export async function ensure_named_profile_index(slot: number): Promise<NamedProfileIndexFile> {
  const index = await load_named_profile_index(slot);
  await write_slot_relative_json_file(slot, NAMED_PROFILE_INDEX_FILE, index).catch(() => null);
  return index;
}

export async function save_named_profile_index(slot: number, next: NamedProfileIndexFile): Promise<NamedProfileIndexFile> {
  const sanitized = sanitize_index(next);
  await write_slot_relative_json_file(slot, NAMED_PROFILE_INDEX_FILE, sanitized);
  return sanitized;
}

export function resolve_selected_profile_id_from_index(index: NamedProfileIndexFile, app_id: CameraSettingsAppId): string {
  const selected = String(index.selected_profile_ids?.[app_id] ?? index.selected_profile_ids?.shared ?? index.profiles[0]?.profile_id ?? DEFAULT_NAMED_PROFILE_ID).trim();
  return normalize_profile_id(selected);
}

export async function resolve_profile_scope(slot: number, app_id: CameraSettingsAppId): Promise<ProfileScope> {
  const index = await ensure_named_profile_index(slot);
  return create_profile_scope(slot, app_id, resolve_selected_profile_id_from_index(index, app_id));
}
