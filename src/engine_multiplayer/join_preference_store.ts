import type { EngineConnectionKind, EngineJoinSelection } from './connection_types.js';
import type { EngineContentRef } from './content_refs.js';
import { encode_content_ref_key, normalize_content_ref } from './content_refs.js';
import { get_slot_json_file_path, read_slot_json_file, write_slot_json_file } from '../engine_persistence/slot_json_store.js';

export type EngineTransportStrategy = 'direct' | 'overlay' | 'relay';

export type EngineJoinPreferenceRecord = {
  content_ref: EngineContentRef;
  preferred_connection_id: string | null;
  preferred_host: string | null;
  preferred_connection_kind: EngineConnectionKind | null;
  last_transport_strategy: EngineTransportStrategy;
  last_connected_at_ms: number;
  app_metadata?: Record<string, unknown> | null;
};

type EngineJoinPreferenceFile = {
  version: 1;
  preferences_by_content_ref: Record<string, EngineJoinPreferenceRecord>;
};

const JOIN_PREFERENCE_FILE_NAME = 'join_preferences.json';

function log_join_preferences(event: string, payload: Record<string, unknown> = {}): void {
  console.log('[JOIN_PREFS]', JSON.stringify({ event, ...payload }));
}

function build_content_ref_log_fields(content_ref: EngineContentRef): Record<string, unknown> {
  const normalized = normalize_content_ref(content_ref);
  return {
    content_ref_kind: normalized.kind,
    content_ref_value: normalized.value,
    content_ref_key: encode_content_ref_key(normalized),
  };
}

function create_default_file(): EngineJoinPreferenceFile {
  return {
    version: 1,
    preferences_by_content_ref: {},
  };
}

function sanitize_app_metadata(value: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  const entries = Object.entries(value).filter(([key]) => String(key).trim().length > 0);
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

function normalize_record(record: EngineJoinPreferenceRecord): EngineJoinPreferenceRecord {
  return {
    content_ref: normalize_content_ref(record.content_ref),
    preferred_connection_id: String(record.preferred_connection_id ?? '').trim() || null,
    preferred_host: String(record.preferred_host ?? '').trim() || null,
    preferred_connection_kind: record.preferred_connection_kind ?? null,
    last_transport_strategy: record.last_transport_strategy,
    last_connected_at_ms: Number.isFinite(Number(record.last_connected_at_ms)) ? Math.floor(Number(record.last_connected_at_ms)) : Date.now(),
    app_metadata: sanitize_app_metadata(record.app_metadata),
  };
}

async function get_join_preference_file_path(slot: number): Promise<string> {
  return get_slot_json_file_path(slot, JOIN_PREFERENCE_FILE_NAME);
}

async function read_join_preference_file(slot: number): Promise<EngineJoinPreferenceFile> {
  const file_path = await get_join_preference_file_path(slot);
  log_join_preferences('read_started', { slot, file_path });
  const response = await read_slot_json_file<EngineJoinPreferenceFile>(slot, JOIN_PREFERENCE_FILE_NAME);
  if (!response.data) {
    log_join_preferences('read_defaulted', {
      slot,
      file_path: response.file_path,
      message: String(response.error ?? 'missing_or_unreadable_file'),
    });
    return create_default_file();
  }
  try {
    const parsed = response.data;
    if (!parsed || parsed.version !== 1 || typeof parsed.preferences_by_content_ref !== 'object' || !parsed.preferences_by_content_ref) {
      throw new Error('invalid_join_preference_schema');
    }
    const normalized_preferences = Object.fromEntries(
      Object.entries(parsed.preferences_by_content_ref)
        .map(([key, value]) => {
          try {
            return [key, normalize_record(value)];
          } catch {
            return null;
          }
        })
        .filter((entry): entry is [string, EngineJoinPreferenceRecord] => Array.isArray(entry)),
    );
    log_join_preferences('read_completed', {
      slot,
      file_path,
      preference_count: Object.keys(normalized_preferences).length,
    });
    return {
      version: 1,
      preferences_by_content_ref: normalized_preferences,
    };
  } catch (error) {
    log_join_preferences('read_invalidated', {
      slot,
      file_path,
      message: error instanceof Error ? error.message : String(error),
    });
    return create_default_file();
  }
}

async function write_join_preference_file(slot: number, file: EngineJoinPreferenceFile): Promise<void> {
  const file_path = await get_join_preference_file_path(slot);
  log_join_preferences('write_started', {
    slot,
    file_path,
    preference_count: Object.keys(file.preferences_by_content_ref).length,
  });
  await write_slot_json_file(slot, JOIN_PREFERENCE_FILE_NAME, file);
  log_join_preferences('write_completed', {
    slot,
    file_path,
    preference_count: Object.keys(file.preferences_by_content_ref).length,
  });
}

export async function resolve_preferred_join_record_for_content_refs(slot: number, content_refs: EngineContentRef[]): Promise<{ record: EngineJoinPreferenceRecord; matched_content_ref: EngineContentRef } | null> {
  for (const content_ref of content_refs) {
    const record = await read_join_preference_for_content(slot, content_ref);
    if (record) {
      return {
        record,
        matched_content_ref: normalize_content_ref(content_ref),
      };
    }
  }
  return null;
}

export async function read_join_preference_for_content(slot: number, content_ref: EngineContentRef): Promise<EngineJoinPreferenceRecord | null> {
  const normalized_content_ref = normalize_content_ref(content_ref);
  const content_ref_key = encode_content_ref_key(normalized_content_ref);
  const started_at_ms = Date.now();
  log_join_preferences('lookup_started', {
    slot,
    started_at_ms,
    ...build_content_ref_log_fields(normalized_content_ref),
  });
  const file = await read_join_preference_file(slot);
  const record = file.preferences_by_content_ref[content_ref_key] ?? null;
  log_join_preferences('lookup_completed', {
    slot,
    latency_ms: Date.now() - started_at_ms,
    found: Boolean(record),
    preferred_connection_id: record?.preferred_connection_id ?? null,
    preferred_host: record?.preferred_host ?? null,
    preferred_connection_kind: record?.preferred_connection_kind ?? null,
    last_transport_strategy: record?.last_transport_strategy ?? null,
    ...build_content_ref_log_fields(normalized_content_ref),
  });
  return record;
}

export async function write_join_preference_for_content(slot: number, record: EngineJoinPreferenceRecord): Promise<EngineJoinPreferenceRecord> {
  const normalized = normalize_record(record);
  const content_ref_key = encode_content_ref_key(normalized.content_ref);
  const started_at_ms = Date.now();
  log_join_preferences('preference_write_started', {
    slot,
    started_at_ms,
    preferred_connection_id: normalized.preferred_connection_id,
    preferred_host: normalized.preferred_host,
    preferred_connection_kind: normalized.preferred_connection_kind,
    last_transport_strategy: normalized.last_transport_strategy,
    ...build_content_ref_log_fields(normalized.content_ref),
  });
  const file = await read_join_preference_file(slot);
  file.preferences_by_content_ref[content_ref_key] = normalized;
  await write_join_preference_file(slot, file);
  log_join_preferences('preference_write_completed', {
    slot,
    latency_ms: Date.now() - started_at_ms,
    preferred_connection_id: normalized.preferred_connection_id,
    preferred_host: normalized.preferred_host,
    preferred_connection_kind: normalized.preferred_connection_kind,
    last_transport_strategy: normalized.last_transport_strategy,
    ...build_content_ref_log_fields(normalized.content_ref),
  });
  return normalized;
}

export async function clear_join_preference_for_content(slot: number, content_ref: EngineContentRef): Promise<void> {
  const normalized_content_ref = normalize_content_ref(content_ref);
  const content_ref_key = encode_content_ref_key(normalized_content_ref);
  const file = await read_join_preference_file(slot);
  if (!file.preferences_by_content_ref[content_ref_key]) return;
  delete file.preferences_by_content_ref[content_ref_key];
  await write_join_preference_file(slot, file);
}

export async function record_successful_connection_for_content(slot: number, args: {
  content_ref: EngineContentRef;
  selection: EngineJoinSelection;
  transport_strategy?: EngineTransportStrategy | null;
  app_metadata?: Record<string, unknown> | null;
}): Promise<EngineJoinPreferenceRecord> {
  log_join_preferences('record_successful_connection_started', {
    slot,
    connection_id: args.selection.connection.id,
    connection_host: args.selection.connection.host,
    connection_kind: args.selection.connection.kind,
    transport_strategy: args.transport_strategy ?? 'direct',
    ...build_content_ref_log_fields(args.content_ref),
  });
  const record: EngineJoinPreferenceRecord = {
    content_ref: normalize_content_ref(args.content_ref),
    preferred_connection_id: args.selection.connection.id,
    preferred_host: args.selection.connection.host,
    preferred_connection_kind: args.selection.connection.kind,
    last_transport_strategy: args.transport_strategy ?? 'direct',
    last_connected_at_ms: Date.now(),
    app_metadata: sanitize_app_metadata(args.app_metadata),
  };
  const persisted = await write_join_preference_for_content(slot, record);
  log_join_preferences('record_successful_connection_completed', {
    slot,
    connection_id: args.selection.connection.id,
    connection_host: args.selection.connection.host,
    connection_kind: args.selection.connection.kind,
    transport_strategy: persisted.last_transport_strategy,
    ...build_content_ref_log_fields(persisted.content_ref),
  });
  return persisted;
}
