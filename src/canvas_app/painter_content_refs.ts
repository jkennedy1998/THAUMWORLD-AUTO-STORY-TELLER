import type { EngineContentRef } from '../engine_multiplayer/content_refs.js';

export function create_painter_file_content_ref(path: string): EngineContentRef {
  const normalized = String(path ?? '').trim();
  if (!normalized) throw new Error('painter_file_content_ref_path_required');
  return {
    kind: 'file',
    value: normalized,
  };
}

export function create_painter_remote_document_content_ref(document_id: string): EngineContentRef {
  const normalized_document_id = String(document_id ?? '').trim();
  if (!normalized_document_id) throw new Error('painter_remote_document_content_ref_document_id_required');
  return {
    kind: 'resource',
    value: `painter_document:${normalized_document_id}`,
  };
}
