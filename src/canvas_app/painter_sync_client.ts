import { debug_warn } from '../shared/debug.js';
import type { PainterDocumentAuthorityMode, PainterDocumentBootstrap } from '../shared/painter_protocol.js';
import { create_painter_multiplayer_session } from './painter_multiplayer_session.js';

export type PainterSyncState = {
  authority_mode: PainterDocumentAuthorityMode;
  lifecycle: 'idle' | 'bootstrapping' | 'ready';
  bootstrap: PainterDocumentBootstrap | null;
  last_patch_command_kind: string | null;
  last_patch_group_id: string | null;
  last_patch_revision: number;
  last_patch_base_revision: number | null;
  last_patch_server_revision_before: number | null;
  last_patch_applied_from_stale_base: boolean;
  last_command_error: string | null;
};

type PainterSyncClientOptions = {
  slot: number;
  get_api_base_url: () => string;
  get_bridge_ws_base_url: () => string;
  reconnect_token_storage_key: string;
};

type PainterSyncSubscriber = (state: PainterSyncState) => void;

export function create_painter_sync_client(options: PainterSyncClientOptions): {
  get_state: () => PainterSyncState;
  subscribe: (listener: PainterSyncSubscriber) => () => void;
  bootstrap: (force?: boolean, document_id?: string | null) => Promise<PainterSyncState>;
  submit_cell_changes: (group_id: string, changes: Array<{ x: number; y: number; z: number; cell: { char: string; rgb: { r: number; g: number; b: number }; weight_index: number; render_index?: number } }>) => Promise<PainterSyncState>;
  submit_group_command: (command: {
    kind: 'create_group' | 'delete_group' | 'duplicate_group' | 'rename_group' | 'set_group_visibility' | 'set_group_locked' | 'reorder_groups' | 'reset_document' | 'undo_group' | 'redo_group';
    group_id?: string;
    source_group_id?: string;
    target_group_id?: string;
    group_name?: string;
    visible?: boolean;
    locked?: boolean;
    next_group_order?: string[];
  }) => Promise<PainterSyncState>;
} {
  const session = create_painter_multiplayer_session(options);
  let patch_listener_attached = false;
  let state: PainterSyncState = {
    authority_mode: 'local_compat',
    lifecycle: 'idle',
    bootstrap: null,
    last_patch_command_kind: null,
    last_patch_group_id: null,
    last_patch_revision: 0,
    last_patch_base_revision: null,
    last_patch_server_revision_before: null,
    last_patch_applied_from_stale_base: false,
    last_command_error: null,
  };
  const listeners = new Set<PainterSyncSubscriber>();

  function emit(): void {
    for (const listener of listeners) listener(state);
  }

  function set_state(next: PainterSyncState): PainterSyncState {
    state = next;
    emit();
    return state;
  }

  function ensure_patch_listener(): void {
    if (patch_listener_attached) return;
    const ws_client = session.get_ws_client();
    if (!ws_client) return;
    patch_listener_attached = true;
    ws_client.on('PAINTER_DOCUMENT_PATCHED', (payload: any) => {
      const active = state.bootstrap;
      if (!active) return;
      const document_id = String(payload?.document_id ?? '').trim();
      if (!document_id || document_id !== active.document_id) return;
      const next_revision = Number(payload?.revision ?? active.revision) || active.revision;
      const expected_revision = active.revision + 1;
      if (next_revision > expected_revision) {
        debug_warn('[PAINTER_SYNC]', 'detected painter patch revision gap; bootstrapping authoritative snapshot', {
          expected_revision,
          received_revision: next_revision,
          document_id,
        });
        void session.ensure_ready(true).then(() => {
          void api.bootstrap(true).catch((error) => {
            debug_warn('[PAINTER_SYNC]', 'failed to recover painter revision gap', {
              error: error instanceof Error ? error.message : String(error),
              document_id,
            });
          });
        });
        return;
      }
      if (next_revision <= active.revision) return;
      set_state({
        ...state,
        last_patch_command_kind: String(payload?.command_kind ?? '').trim() || null,
        last_patch_group_id: String(payload?.group_id ?? '').trim() || null,
        last_patch_revision: next_revision,
        last_patch_base_revision: Number.isFinite(Number(payload?.base_revision)) ? Math.max(0, Math.floor(Number(payload.base_revision))) : null,
        last_patch_server_revision_before: Number.isFinite(Number(payload?.server_revision_before)) ? Math.max(0, Math.floor(Number(payload.server_revision_before))) : null,
        last_patch_applied_from_stale_base: Boolean(payload?.applied_from_stale_base),
        last_command_error: null,
        bootstrap: {
          ...active,
          revision: next_revision,
          snapshot: payload?.snapshot ?? active.snapshot,
        },
      });
      if (payload?.applied_from_stale_base) {
        debug_warn('[PAINTER_SYNC]', 'accepted painter command from stale client base revision', {
          document_id,
          base_revision: payload?.base_revision ?? null,
          server_revision_before: payload?.server_revision_before ?? null,
          server_revision_after: payload?.server_revision_after ?? null,
          command_kind: payload?.command_kind ?? null,
          group_id: payload?.group_id ?? null,
        });
      }
    });
  }

  const api = {
    get_state: () => state,
    subscribe(listener: PainterSyncSubscriber): () => void {
      listeners.add(listener);
      listener(state);
      return () => {
        listeners.delete(listener);
      };
    },
    async bootstrap(force: boolean = false, document_id?: string | null): Promise<PainterSyncState> {
      set_state({ ...state, lifecycle: 'bootstrapping', last_command_error: null });
      const session_state = await session.ensure_ready(force);
      if (session_state.authority_mode === 'authoritative_host' && session_state.session_token) {
        ensure_patch_listener();
        const requested_document_id = String(document_id ?? '').trim();
        const query = [
          `slot=${encodeURIComponent(String(options.slot))}`,
          `session_token=${encodeURIComponent(session_state.session_token)}`,
        ];
        if (requested_document_id) {
          query.push(`document_id=${encodeURIComponent(requested_document_id)}`);
        }
        const response = await fetch(`${options.get_api_base_url()}/painter/document/bootstrap?${query.join('&')}`);
        const data = await response.json().catch(() => null) as any;
        if (!response.ok || !data?.ok) {
          throw new Error(String(data?.error ?? `painter_document_bootstrap_failed:${response.status}`));
        }
        set_state({
          authority_mode: 'authoritative_host',
          lifecycle: 'ready',
          last_patch_command_kind: state.last_patch_command_kind,
          last_patch_group_id: state.last_patch_group_id,
          last_patch_revision: state.last_patch_revision,
          last_patch_base_revision: state.last_patch_base_revision,
          last_patch_server_revision_before: state.last_patch_server_revision_before,
          last_patch_applied_from_stale_base: state.last_patch_applied_from_stale_base,
          last_command_error: null,
          bootstrap: {
            document_id: String(data?.document_id ?? session_state.document_id),
            authority_mode: 'authoritative_host',
            slot: options.slot,
            revision: Number(data?.revision ?? 0) || 0,
            snapshot: data?.snapshot ?? null,
            session_token: session_state.session_token,
            connection_id: session_state.connection_id,
            reconnect_token: session_state.reconnect_token,
            host_boot_id: session_state.host_boot_id,
            join_mode: session_state.join_mode,
            supports_join: session_state.supports_join,
            error: null,
          },
        });
        return state;
      }
      return state;
    },
    async submit_cell_changes(group_id: string, changes: Array<{ x: number; y: number; z: number; cell: { char: string; rgb: { r: number; g: number; b: number }; weight_index: number; render_index?: number } }>): Promise<PainterSyncState> {
      const active = state.bootstrap;
      if (!active || state.authority_mode !== 'authoritative_host' || !active.session_token || !group_id || changes.length < 1) {
        return state;
      }
      const response = await fetch(`${options.get_api_base_url()}/painter/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slot: options.slot,
          session_token: active.session_token,
          command: {
            kind: 'apply_group_voxels',
            document_id: active.document_id,
            group_id,
            base_revision: active.revision,
            command_id: `paint_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
            voxels: changes.map((change) => ({
              x: change.x,
              y: change.y,
              z: change.z,
              char: change.cell.char,
              rgb: { ...change.cell.rgb },
              weight_index: change.cell.weight_index,
              render_index: change.cell.render_index,
            })),
          },
        }),
      });
      const data = await response.json().catch(() => null) as any;
      if (!response.ok || !data?.ok) {
        const error = String(data?.error ?? `painter_command_failed:${response.status}`);
        set_state({ ...state, last_command_error: error });
        throw new Error(error);
      }
      set_state({
        ...state,
        last_patch_command_kind: String(data?.command_kind ?? state.last_patch_command_kind ?? '').trim() || state.last_patch_command_kind,
        last_patch_group_id: String(data?.group_id ?? state.last_patch_group_id ?? '').trim() || state.last_patch_group_id,
        last_patch_revision: Number(data?.revision ?? state.last_patch_revision) || state.last_patch_revision,
        last_patch_base_revision: Number.isFinite(Number(data?.base_revision)) ? Math.max(0, Math.floor(Number(data.base_revision))) : state.last_patch_base_revision,
        last_patch_server_revision_before: Number.isFinite(Number(data?.server_revision_before)) ? Math.max(0, Math.floor(Number(data.server_revision_before))) : state.last_patch_server_revision_before,
        last_patch_applied_from_stale_base: Boolean(data?.applied_from_stale_base),
        last_command_error: null,
        bootstrap: state.bootstrap ? {
          ...state.bootstrap,
          revision: Number(data?.revision ?? state.bootstrap.revision) || state.bootstrap.revision,
          snapshot: data?.snapshot ?? state.bootstrap.snapshot,
        } : state.bootstrap,
      });
      return state;
    },
    async submit_group_command(command: {
      kind: 'create_group' | 'delete_group' | 'duplicate_group' | 'rename_group' | 'set_group_visibility' | 'set_group_locked' | 'reorder_groups' | 'reset_document' | 'undo_group' | 'redo_group';
      group_id?: string;
      source_group_id?: string;
      target_group_id?: string;
      group_name?: string;
      visible?: boolean;
      locked?: boolean;
      next_group_order?: string[];
    }): Promise<PainterSyncState> {
      const active = state.bootstrap;
      if (!active || state.authority_mode !== 'authoritative_host' || !active.session_token) {
        return state;
      }
      const response = await fetch(`${options.get_api_base_url()}/painter/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slot: options.slot,
          session_token: active.session_token,
          command: {
            document_id: active.document_id,
            base_revision: active.revision,
            command_id: `paint_group_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
            ...command,
          },
        }),
      });
      const data = await response.json().catch(() => null) as any;
      if (!response.ok || !data?.ok) {
        const error = String(data?.error ?? `painter_group_command_failed:${response.status}`);
        set_state({ ...state, last_command_error: error });
        throw new Error(error);
      }
      set_state({
        ...state,
        last_patch_command_kind: String(data?.command_kind ?? state.last_patch_command_kind ?? '').trim() || state.last_patch_command_kind,
        last_patch_group_id: String(data?.group_id ?? state.last_patch_group_id ?? '').trim() || state.last_patch_group_id,
        last_patch_revision: Number(data?.revision ?? state.last_patch_revision) || state.last_patch_revision,
        last_patch_base_revision: Number.isFinite(Number(data?.base_revision)) ? Math.max(0, Math.floor(Number(data.base_revision))) : state.last_patch_base_revision,
        last_patch_server_revision_before: Number.isFinite(Number(data?.server_revision_before)) ? Math.max(0, Math.floor(Number(data.server_revision_before))) : state.last_patch_server_revision_before,
        last_patch_applied_from_stale_base: Boolean(data?.applied_from_stale_base),
        last_command_error: null,
        bootstrap: state.bootstrap ? {
          ...state.bootstrap,
          revision: Number(data?.revision ?? state.bootstrap.revision) || state.bootstrap.revision,
          snapshot: data?.snapshot ?? state.bootstrap.snapshot,
        } : state.bootstrap,
      });
      return state;
    },
  };

  session.subscribe((session_state) => {
    set_state({
      authority_mode: session_state.authority_mode,
      lifecycle: session_state.lifecycle === 'idle' ? 'idle' : 'ready',
      last_patch_command_kind: state.last_patch_command_kind,
      last_patch_group_id: state.last_patch_group_id,
      last_patch_revision: state.last_patch_revision,
      last_patch_base_revision: state.last_patch_base_revision,
      last_patch_server_revision_before: state.last_patch_server_revision_before,
      last_patch_applied_from_stale_base: state.last_patch_applied_from_stale_base,
      last_command_error: state.last_command_error,
      bootstrap: {
        document_id: session_state.document_id,
        authority_mode: session_state.authority_mode,
        slot: session_state.slot,
        revision: session_state.revision,
        snapshot: session_state.snapshot,
        session_token: session_state.session_token,
        connection_id: session_state.connection_id,
        reconnect_token: session_state.reconnect_token,
        host_boot_id: session_state.host_boot_id,
        join_mode: session_state.join_mode,
        supports_join: session_state.supports_join,
        error: session_state.error,
      },
    });
  });

  return api;
}
