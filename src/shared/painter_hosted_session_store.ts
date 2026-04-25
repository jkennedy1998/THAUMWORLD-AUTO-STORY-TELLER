import * as fs from 'node:fs';
import { get_data_slot_dir } from '../engine/paths.js';
import { read_jsonc_file_or_default, write_json_file } from './json_file.js';

export type PainterHostedSessionRecord = {
  document_id: string;
  display_name: string;
  file_backed: boolean;
  owner_session_token: string;
  updated_at: string;
};

type PainterHostedSessionFile = {
  version: 1;
  session: PainterHostedSessionRecord | null;
};

function get_painter_hosted_session_path(slot: number): string {
  return `${get_data_slot_dir(slot)}/painter_hosted_session.json`;
}

function log_hosted_session_store(event: string, payload: Record<string, unknown> = {}): void {
  console.log('[PAINTER_HOSTED_SESSION_STORE]', JSON.stringify({
    event,
    cwd: process.cwd(),
    pid: process.pid,
    ...payload,
  }));
}

function create_default_file(): PainterHostedSessionFile {
  return {
    version: 1,
    session: null,
  };
}

export function read_painter_hosted_session(slot: number): PainterHostedSessionRecord | null {
  const filePath = get_painter_hosted_session_path(slot);
  const exists = fs.existsSync(filePath);
  log_hosted_session_store('read_started', {
    slot,
    file_path: filePath,
    file_exists: exists,
  });
  const file = read_jsonc_file_or_default(filePath, create_default_file) as PainterHostedSessionFile;
  const session = file?.session;
  if (!session) {
    log_hosted_session_store('read_completed', {
      slot,
      file_path: filePath,
      file_exists: exists,
      session_present: false,
    });
    return null;
  }
  const normalized = {
    document_id: String(session.document_id ?? '').trim() || 'default_canvas',
    display_name: String(session.display_name ?? '').trim() || 'untitled',
    file_backed: Boolean(session.file_backed),
    owner_session_token: String(session.owner_session_token ?? '').trim(),
    updated_at: String(session.updated_at ?? '').trim() || new Date().toISOString(),
  };
  log_hosted_session_store('read_completed', {
    slot,
    file_path: filePath,
    file_exists: exists,
    session_present: true,
    document_id: normalized.document_id,
    display_name: normalized.display_name,
    file_backed: normalized.file_backed,
    updated_at: normalized.updated_at,
    owner_session_token_present: Boolean(normalized.owner_session_token),
  });
  return normalized;
}

export function write_painter_hosted_session(slot: number, session: PainterHostedSessionRecord | null): void {
  const filePath = get_painter_hosted_session_path(slot);
  log_hosted_session_store('write_started', {
    slot,
    file_path: filePath,
    session_present: Boolean(session),
    document_id: session?.document_id ?? null,
    display_name: session?.display_name ?? null,
    file_backed: session?.file_backed ?? false,
    updated_at: session?.updated_at ?? null,
    owner_session_token_present: Boolean(session?.owner_session_token),
  });
  write_json_file(filePath, {
    version: 1,
    session,
  } satisfies PainterHostedSessionFile);
  log_hosted_session_store('write_completed', {
    slot,
    file_path: filePath,
    file_exists: fs.existsSync(filePath),
    file_size_bytes: fs.existsSync(filePath) ? fs.statSync(filePath).size : null,
    session_present: Boolean(session),
  });
}
