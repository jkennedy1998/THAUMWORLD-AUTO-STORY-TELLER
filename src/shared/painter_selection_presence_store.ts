import type { PainterSelectionChannelSnapshot } from './painter_protocol.js';

type DocumentSelectionMap = Map<string, PainterSelectionChannelSnapshot>;

const selection_store = new Map<string, DocumentSelectionMap>();

function make_document_key(slot: number, document_id: string): string {
  return `${Math.max(1, Math.floor(slot || 1))}:${String(document_id ?? '').trim() || 'default_canvas'}`;
}

function clone_snapshot(snapshot: PainterSelectionChannelSnapshot): PainterSelectionChannelSnapshot {
  return {
    connection_id: snapshot.connection_id,
    color_rgb: { ...snapshot.color_rgb },
    cells: snapshot.cells.map((cell) => ({ x: cell.x, y: cell.y, z: cell.z })),
    updated_at_ms: snapshot.updated_at_ms,
  };
}

export function list_painter_selection_channels(slot: number, document_id: string): PainterSelectionChannelSnapshot[] {
  const key = make_document_key(slot, document_id);
  const doc = selection_store.get(key);
  if (!doc) return [];
  return Array.from(doc.values()).map(clone_snapshot);
}

export function set_painter_selection_channel(slot: number, document_id: string, snapshot: PainterSelectionChannelSnapshot): PainterSelectionChannelSnapshot {
  const key = make_document_key(slot, document_id);
  let doc = selection_store.get(key);
  if (!doc) {
    doc = new Map<string, PainterSelectionChannelSnapshot>();
    selection_store.set(key, doc);
  }
  const normalized = clone_snapshot({
    ...snapshot,
    connection_id: String(snapshot.connection_id ?? '').trim(),
    updated_at_ms: Number(snapshot.updated_at_ms ?? Date.now()) || Date.now(),
    cells: Array.isArray(snapshot.cells)
      ? snapshot.cells.map((cell) => ({ x: Math.floor(Number(cell.x ?? 0)), y: Math.floor(Number(cell.y ?? 0)), z: Math.floor(Number(cell.z ?? 0)) }))
      : [],
  });
  if (!normalized.connection_id) throw new Error('painter_selection_connection_id_required');
  doc.set(normalized.connection_id, normalized);
  return clone_snapshot(normalized);
}

export function clear_painter_selection_channel(slot: number, document_id: string, connection_id: string): void {
  const key = make_document_key(slot, document_id);
  const doc = selection_store.get(key);
  if (!doc) return;
  doc.delete(String(connection_id ?? '').trim());
  if (doc.size < 1) selection_store.delete(key);
}

export function clear_painter_selection_document(slot: number, document_id: string): void {
  selection_store.delete(make_document_key(slot, document_id));
}

export function clear_painter_selection_slot(slot: number): void {
  const prefix = `${Math.max(1, Math.floor(slot || 1))}:`;
  for (const key of Array.from(selection_store.keys())) {
    if (!key.startsWith(prefix)) continue;
    selection_store.delete(key);
  }
}
