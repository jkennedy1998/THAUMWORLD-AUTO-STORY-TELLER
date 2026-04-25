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

function create_default_file(): PainterHostedSessionFile {
  return {
    version: 1,
    session: null,
  };
}

export function read_painter_hosted_session(slot: number): PainterHostedSessionRecord | null {
  const file = read_jsonc_file_or_default(get_painter_hosted_session_path(slot), create_default_file) as PainterHostedSessionFile;
  const session = file?.session;
  if (!session) return null;
  return {
    document_id: String(session.document_id ?? '').trim() || 'default_canvas',
    display_name: String(session.display_name ?? '').trim() || 'untitled',
    file_backed: Boolean(session.file_backed),
    owner_session_token: String(session.owner_session_token ?? '').trim(),
    updated_at: String(session.updated_at ?? '').trim() || new Date().toISOString(),
  };
}

export function write_painter_hosted_session(slot: number, session: PainterHostedSessionRecord | null): void {
  write_json_file(get_painter_hosted_session_path(slot), {
    version: 1,
    session,
  } satisfies PainterHostedSessionFile);
}
