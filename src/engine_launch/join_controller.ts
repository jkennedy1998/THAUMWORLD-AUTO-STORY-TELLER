import type { Module, Rect } from '../mono_ui/types.js';
import { build_join_directory, build_join_selection } from '../engine_multiplayer/join_directory.js';
import { forget_manual_connection, rename_manual_connection, save_manual_connection, update_manual_connection_host } from '../engine_multiplayer/connection_store.js';
import { is_connection_host_editable, is_connection_name_editable, is_connection_removable, type EngineJoinSelection } from '../engine_multiplayer/connection_types.js';
import { make_join_directory_module } from '../mono_ui/modules/join_directory_module.js';
import type { JoinMenuState, TaiJoinRequest, TaiJoinResolution, TaiJoinSnapshot } from './join_menu_types.js';

export function create_join_controller(args: {
  id: string;
  rect: Rect;
  slot: number;
  title?: string;
  get_is_visible: () => boolean;
  on_join_selection: (selection: EngineJoinSelection) => Promise<void> | void;
  on_back: () => void;
  on_move?: (rect: Rect) => void;
}): {
  modules: readonly Module[];
  refresh: () => Promise<void>;
  join_selected: () => Promise<void>;
  get_selected_connection_id: () => string | null;
  get_tai_join_snapshot: () => TaiJoinSnapshot;
  get_connection_ids: () => string[];
  get_status_lines: () => string[];
  select_connection_by_id: (id: string) => boolean;
  select_connection_by_host: (host: string) => boolean;
  select_first_connection_by_kind: (kind: 'local' | 'saved_manual' | 'lan_discovered') => boolean;
  apply_tai_join_request: (request: TaiJoinRequest) => Promise<TaiJoinResolution>;
} {
  let state: JoinMenuState = {
    selected_connection_id: null,
    connections: [],
    probes_by_connection_id: {},
    status_lines: ['searching for connections...'],
    is_refreshing: false,
    editor: {
      mode: 'hidden',
      connection_id: null,
      draft_name: '',
      draft_host: '',
      active_field: 'host',
      error: null,
    },
  };

  function log_join_ui(event: string, payload: Record<string, unknown> = {}): void {
    console.log('[JOIN_UI]', JSON.stringify({
      event,
      module_id: args.id,
      slot: args.slot,
      selected_connection_id: state.selected_connection_id,
      ...payload,
    }));
  }

  function get_selected_connection() {
    return state.connections.find((entry) => entry.id === state.selected_connection_id) ?? null;
  }

  function get_tai_join_snapshot(): TaiJoinSnapshot {
    const connection = get_selected_connection();
    const probe = connection ? state.probes_by_connection_id[connection.id] ?? null : null;
    const selection = connection ? build_join_selection(connection, probe, args.slot) : null;
    return {
      selected_connection_id: connection?.id ?? null,
      selected_connection_host: connection?.host ?? null,
      selected_connection_kind: connection?.kind ?? null,
      probe_status: probe?.status ?? null,
      supports_join: Boolean(probe?.supports_join),
      join_mode: probe?.join_mode ?? null,
      world_label: probe?.world_label ?? null,
      painter_document_id: probe?.painter_document_id ?? null,
      api_base_url: selection?.transport.api_base_url ?? null,
      bridge_ws_base_url: selection?.transport.bridge_ws_base_url ?? null,
      status_lines: [...state.status_lines],
    };
  }

  function select_connection(connection_id: string): boolean {
    const exists = state.connections.some((entry) => entry.id === connection_id);
    if (!exists) return false;
    state = { ...state, selected_connection_id: connection_id };
    state = { ...state, status_lines: compute_status_lines() };
    const selected = get_selected_connection();
    log_join_ui('select_connection', {
      connection_id,
      connection_host: selected?.host ?? null,
      connection_kind: selected?.kind ?? null,
    });
    return true;
  }

  function close_editor(): void {
    log_join_ui('close_editor', { mode: state.editor.mode });
    state = {
      ...state,
      editor: {
        mode: 'hidden',
        connection_id: null,
        draft_name: '',
        draft_host: '',
        active_field: 'host',
        error: null,
      },
    };
  }

  function compute_status_lines(): string[] {
    const online = state.connections.filter((entry) => state.probes_by_connection_id[entry.id]?.status === 'online').length;
    const local = state.connections.filter((entry) => entry.kind === 'local').length;
    const saved = state.connections.filter((entry) => entry.kind === 'saved_manual').length;
    const selected = get_selected_connection();
    const selectedProbe = selected ? state.probes_by_connection_id[selected.id] : null;
    return selected
      ? [`${online}/${state.connections.length} online | local ${local} | saved ${saved}`, selectedProbe?.status_message ?? selected.name]
      : ['no connection selected'];
  }

  async function refresh(reason: string = 'manual_refresh'): Promise<void> {
    log_join_ui('refresh_started', { reason });
    state = { ...state, is_refreshing: true, status_lines: ['refreshing connections...'] };
    const directory = await build_join_directory(args.slot);
    const previous = state.selected_connection_id;
    const selected_connection_id = previous && directory.connections.some((entry) => entry.id === previous)
      ? previous
      : (directory.connections[0]?.id ?? null);
    state = {
      ...state,
      selected_connection_id,
      connections: directory.connections,
      probes_by_connection_id: directory.probes_by_connection_id,
      is_refreshing: false,
      status_lines: [],
    };
    state = { ...state, status_lines: compute_status_lines() };
    log_join_ui('refresh_completed', {
      reason,
      connection_count: state.connections.length,
      online_count: state.connections.filter((entry) => state.probes_by_connection_id[entry.id]?.status === 'online').length,
      status_lines: state.status_lines,
    });
  }

  function open_editor(mode: 'add' | 'rename' | 'edit_host'): void {
    log_join_ui('open_editor', { mode, selected_connection_id: state.selected_connection_id });
    const selected = get_selected_connection();
    state = {
      ...state,
      editor: {
        mode,
        connection_id: selected?.id ?? null,
        draft_name: mode === 'add' ? 'New Connection' : String(selected?.name ?? ''),
        draft_host: mode === 'add' ? '' : String(selected?.host ?? ''),
        active_field: mode === 'rename' ? 'name' : 'host',
        error: null,
      },
      status_lines: mode === 'add'
        ? ['add connection', 'enter a name and host']
        : mode === 'rename'
          ? ['rename connection', 'press enter to save']
          : ['edit connection host', 'press enter to save'],
    };
  }

  async function join_selected(trigger: string = 'manual_join_button'): Promise<void> {
    const connection = get_selected_connection();
    if (!connection) {
      state = { ...state, status_lines: ['select a connection to join'] };
      log_join_ui('join_requested_without_selection', { trigger });
      return;
    }
    const probe = state.probes_by_connection_id[connection.id] ?? null;
    const selection = build_join_selection(connection, probe, args.slot);
    log_join_ui('join_requested', {
      trigger,
      connection_id: connection.id,
      connection_host: connection.host,
      connection_kind: connection.kind,
      probe_status: probe?.status ?? null,
      supports_join: Boolean(probe?.supports_join),
      api_base_url: selection.transport.api_base_url,
      bridge_ws_base_url: selection.transport.bridge_ws_base_url,
    });
    try {
      await args.on_join_selection(selection);
      log_join_ui('join_completed', { trigger, connection_id: connection.id, connection_host: connection.host });
    } catch (err) {
      log_join_ui('join_failed', {
        trigger,
        connection_id: connection.id,
        connection_host: connection.host,
        message: err instanceof Error ? err.message : String(err),
      });
      state = {
        ...state,
        status_lines: [
          `failed to join ${connection.name}`,
          err instanceof Error ? err.message : String(err),
        ],
      };
    }
  }

  function normalize_host(value: string | null | undefined): string {
    return String(value ?? '').trim().toLowerCase();
  }

  function select_connection_by_id(id: string): boolean {
    return select_connection(String(id ?? '').trim());
  }

  function select_connection_by_host(host: string): boolean {
    const normalized = normalize_host(host);
    if (!normalized) return false;
    const match = state.connections.find((entry) => normalize_host(entry.host) === normalized);
    if (!match) return false;
    return select_connection(match.id);
  }

  function select_first_connection_by_kind(kind: 'local' | 'saved_manual' | 'lan_discovered'): boolean {
    const match = state.connections.find((entry) => entry.kind === kind);
    if (!match) return false;
    return select_connection(match.id);
  }

  async function apply_tai_join_request(request: TaiJoinRequest): Promise<TaiJoinResolution> {
    await refresh('tai_request');
    const preferred_id = String(request.preferred_connection_id ?? '').trim();
    const preferred_host = String(request.preferred_host ?? '').trim();
    const preferred_kind = request.preferred_connection_kind ?? null;
    let matched_by: TaiJoinResolution['matched_by'] = 'none';
    let selected_connection_id: string | null = null;
    if (preferred_id && select_connection_by_id(preferred_id)) {
      matched_by = 'id';
      selected_connection_id = state.selected_connection_id;
    } else if (preferred_host && select_connection_by_host(preferred_host)) {
      matched_by = 'host';
      selected_connection_id = state.selected_connection_id;
    } else if (preferred_kind && select_first_connection_by_kind(preferred_kind)) {
      matched_by = 'kind';
      selected_connection_id = state.selected_connection_id;
    } else if (state.connections[0] && select_connection(state.connections[0].id)) {
      matched_by = 'default';
      selected_connection_id = state.selected_connection_id;
    }
    const selected = get_selected_connection();
    const probe = selected ? (state.probes_by_connection_id[selected.id] ?? null) : null;
    const selection = selected ? build_join_selection(selected, probe, args.slot) : null;
    const can_join = Boolean(selected && probe?.status === 'online' && probe?.supports_join === true);
    let reason: string | undefined;
    if (!selected) {
      reason = 'no_connection_available';
    } else if (probe?.status !== 'online') {
      reason = `connection_offline:${probe?.status ?? 'unknown'}`;
    } else if (probe?.supports_join !== true) {
      reason = `connection_not_joinable:${probe?.join_mode ?? 'unknown'}`;
    }
    console.log('[JOIN_TAI]', JSON.stringify({
      request,
      matched_by,
      selected_connection_id,
      selected_connection_host: selected?.host ?? null,
      selected_connection_kind: selected?.kind ?? null,
      can_join,
      probe_status: probe?.status ?? null,
      supports_join: Boolean(probe?.supports_join),
      join_mode: probe?.join_mode ?? null,
      world_label: probe?.world_label ?? null,
      painter_document_id: probe?.painter_document_id ?? null,
      api_base_url: selection?.transport.api_base_url ?? null,
      bridge_ws_base_url: selection?.transport.bridge_ws_base_url ?? null,
      status_lines: state.status_lines,
      reason: reason ?? null,
    }));
    if (request.auto_join && can_join) {
      await join_selected('tai_auto_join');
    }
    return {
      selected_connection_id,
      selected_connection_host: selected?.host ?? null,
      selected_connection_kind: selected?.kind ?? null,
      probe_status: probe?.status ?? null,
      supports_join: Boolean(probe?.supports_join),
      join_mode: probe?.join_mode ?? null,
      world_label: probe?.world_label ?? null,
      painter_document_id: probe?.painter_document_id ?? null,
      api_base_url: selection?.transport.api_base_url ?? null,
      bridge_ws_base_url: selection?.transport.bridge_ws_base_url ?? null,
      matched_by,
      can_join,
      reason,
    };
  }

  async function submit_editor(): Promise<void> {
    try {
      const editor = state.editor;
      log_join_ui('submit_editor', {
        mode: editor.mode,
        connection_id: editor.connection_id,
        draft_name: editor.draft_name,
        draft_host: editor.draft_host,
      });
      if (editor.mode === 'add') {
        const saved = save_manual_connection(editor.draft_host, editor.draft_name);
        close_editor();
        await refresh('editor_add_saved');
        state = { ...state, selected_connection_id: saved.id, status_lines: [`saved ${saved.name}`, `probing ${saved.host}...`] };
        log_join_ui('editor_add_saved', { connection_id: saved.id, connection_host: saved.host });
        await refresh('editor_probe_saved_host');
        return;
      }
      if (!editor.connection_id) throw new Error('connection_not_selected');
      if (editor.mode === 'rename') {
        const saved = rename_manual_connection(editor.connection_id, editor.draft_name);
        close_editor();
        await refresh('editor_rename_saved');
        state = { ...state, selected_connection_id: saved.id, status_lines: [`renamed to ${saved.name}`] };
        log_join_ui('editor_rename_saved', { connection_id: saved.id, connection_name: saved.name });
        return;
      }
      if (editor.mode === 'edit_host') {
        const saved = update_manual_connection_host(editor.connection_id, editor.draft_host);
        close_editor();
        await refresh('editor_host_updated');
        state = { ...state, selected_connection_id: saved.id, status_lines: [`updated host to ${saved.host}`] };
        log_join_ui('editor_host_updated', { connection_id: saved.id, connection_host: saved.host });
      }
    } catch (err) {
      log_join_ui('submit_editor_failed', { message: err instanceof Error ? err.message : String(err) });
      state = {
        ...state,
        editor: {
          ...state.editor,
          error: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  async function forget_selected(): Promise<void> {
    const selected = get_selected_connection();
    if (!selected || !is_connection_removable(selected.kind)) {
      state = { ...state, status_lines: ['selected connection cannot be forgotten'] };
      log_join_ui('forget_rejected', { selected_connection_id: selected?.id ?? null });
      return;
    }
    log_join_ui('forget_selected', { connection_id: selected.id, connection_host: selected.host });
    forget_manual_connection(selected.id);
    state = { ...state, status_lines: [`forgot ${selected.name}`] };
    await refresh('forget_selected');
  }

  const module = make_join_directory_module({
    id: args.id,
    rect: args.rect,
    title: args.title,
    get_is_visible: args.get_is_visible,
    get_connections: () => state.connections,
    get_probes_by_connection_id: () => state.probes_by_connection_id,
    get_selected_connection_id: () => state.selected_connection_id,
    get_editor_state: () => state.editor,
    get_status_lines: () => state.status_lines,
    on_select_connection: (connection_id) => {
      void select_connection(connection_id);
    },
    on_join_selected: () => { void join_selected('manual_join_button'); },
    on_begin_add: () => open_editor('add'),
    on_begin_rename_selected: () => {
      const selected = get_selected_connection();
      if (!selected || !is_connection_name_editable(selected.kind)) {
        state = { ...state, status_lines: ['selected connection cannot be renamed'] };
        return;
      }
      open_editor('rename');
    },
    on_begin_edit_host_selected: () => {
      const selected = get_selected_connection();
      if (!selected || !is_connection_host_editable(selected.kind)) {
        state = { ...state, status_lines: ['selected connection host cannot be edited'] };
        return;
      }
      open_editor('edit_host');
    },
    on_forget_selected: () => { void forget_selected(); },
    on_set_editor_field: (field) => {
      state = { ...state, editor: { ...state.editor, active_field: field } };
      log_join_ui('editor_field_selected', { field });
    },
    on_cycle_editor_field: () => {
      state = { ...state, editor: { ...state.editor, active_field: state.editor.active_field === 'name' ? 'host' : 'name' } };
      log_join_ui('editor_field_cycled', { field: state.editor.active_field });
    },
    on_submit_editor: () => { void submit_editor(); },
    on_cancel_editor: () => close_editor(),
    on_back: () => {
      log_join_ui('back_pressed');
      args.on_back();
    },
    on_refresh: () => { void refresh('manual_refresh_button'); },
    on_editor_name_change: (next_value) => {
      state = { ...state, editor: { ...state.editor, draft_name: next_value, error: null } };
      log_join_ui('editor_name_changed', { length: next_value.length });
    },
    on_editor_host_change: (next_value) => {
      state = { ...state, editor: { ...state.editor, draft_host: next_value, error: null } };
      log_join_ui('editor_host_changed', { host: next_value });
    },
    on_move: args.on_move,
  });

  return {
    modules: [module],
    refresh,
    join_selected,
    get_selected_connection_id: () => state.selected_connection_id,
    get_tai_join_snapshot,
    get_connection_ids: () => state.connections.map((entry) => entry.id),
    get_status_lines: () => [...state.status_lines],
    select_connection_by_id,
    select_connection_by_host,
    select_first_connection_by_kind,
    apply_tai_join_request,
  };
}
