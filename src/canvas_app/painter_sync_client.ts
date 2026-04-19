import type { PainterDocumentAuthorityMode, PainterDocumentBootstrap } from '../shared/painter_protocol.js';
import { create_painter_multiplayer_session } from './painter_multiplayer_session.js';

export type PainterSyncState = {
  authority_mode: PainterDocumentAuthorityMode;
  lifecycle: 'idle' | 'bootstrapping' | 'ready';
  bootstrap: PainterDocumentBootstrap | null;
};

type PainterSyncClientOptions = {
  slot: number;
  api_base_url: string;
  websocket_port: number;
  reconnect_token_storage_key: string;
};

type PainterSyncSubscriber = (state: PainterSyncState) => void;

export function create_painter_sync_client(options: PainterSyncClientOptions): {
  get_state: () => PainterSyncState;
  subscribe: (listener: PainterSyncSubscriber) => () => void;
  bootstrap: (force?: boolean) => Promise<PainterSyncState>;
  submit_cell_changes: (changes: Array<{ x: number; y: number; z: number; cell: { char: string; rgb: { r: number; g: number; b: number }; weight_index: number; render_index?: number } }>) => Promise<PainterSyncState>;
} {
  const session = create_painter_multiplayer_session(options);
  let patch_listener_attached = false;
  let state: PainterSyncState = {
    authority_mode: 'local_compat',
    lifecycle: 'idle',
    bootstrap: null,
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
      set_state({
        ...state,
        bootstrap: {
          ...active,
          revision: Number(payload?.revision ?? active.revision) || active.revision,
          snapshot: payload?.snapshot ?? active.snapshot,
        },
      });
    });
  }

  session.subscribe((session_state) => {
    set_state({
      authority_mode: session_state.authority_mode,
      lifecycle: session_state.lifecycle === 'idle' ? 'idle' : 'ready',
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

  return {
    get_state: () => state,
    subscribe(listener: PainterSyncSubscriber): () => void {
      listeners.add(listener);
      listener(state);
      return () => {
        listeners.delete(listener);
      };
    },
    async bootstrap(force: boolean = false): Promise<PainterSyncState> {
      set_state({ ...state, lifecycle: 'bootstrapping' });
      const session_state = await session.ensure_ready(force);
      if (session_state.authority_mode === 'authoritative_host' && session_state.session_token) {
        ensure_patch_listener();
        const response = await fetch(`${options.api_base_url}/painter/document/bootstrap?slot=${encodeURIComponent(String(options.slot))}&session_token=${encodeURIComponent(session_state.session_token)}`);
        const data = await response.json().catch(() => null) as any;
        if (!response.ok || !data?.ok) {
          throw new Error(String(data?.error ?? `painter_document_bootstrap_failed:${response.status}`));
        }
        set_state({
          authority_mode: 'authoritative_host',
          lifecycle: 'ready',
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
    async submit_cell_changes(changes): Promise<PainterSyncState> {
      const active = state.bootstrap;
      if (!active || state.authority_mode !== 'authoritative_host' || !active.session_token || changes.length < 1) {
        return state;
      }
      const response = await fetch(`${options.api_base_url}/painter/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slot: options.slot,
          session_token: active.session_token,
          command: {
            kind: 'apply_cells',
            document_id: active.document_id,
            base_revision: active.revision,
            command_id: `paint_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
            cells: changes.map((change) => ({
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
        throw new Error(String(data?.error ?? `painter_command_failed:${response.status}`));
      }
      set_state({
        ...state,
        bootstrap: state.bootstrap ? {
          ...state.bootstrap,
          revision: Number(data?.revision ?? state.bootstrap.revision) || state.bootstrap.revision,
          snapshot: data?.snapshot ?? state.bootstrap.snapshot,
        } : state.bootstrap,
      });
      return state;
    },
  };
}
