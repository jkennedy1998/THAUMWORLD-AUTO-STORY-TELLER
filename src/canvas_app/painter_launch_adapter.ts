import type { LaunchAdapter } from '../engine_launch/controller.js';
import { load_launch_record, save_launch_record } from '../engine_launch/persistence.js';
import type { LaunchJoinEntry, ResumeValidationResult } from '../engine_launch/types.js';
import type { TaiJoinRequest } from '../engine_launch/join_menu_types.js';
import { save_manual_connection } from '../engine_multiplayer/connection_store.js';
import { debug_warn } from '../shared/debug.js';
import { importPainterDocumentFromJSON, importVoxelSpaceFromJSON } from '../ascii_painter/save_system.js';
import type { PainterLaunchIntent } from './painter_launch_types.js';
import { PAINTER_APP_CONFIG } from './painter_runtime_config.js';
import { discover_local_joinable_worlds } from './world_discovery.js';

const APP_ID = 'ascii_painter' as const;

function log_painter_launch(event: string, payload: Record<string, unknown> = {}): void {
  console.log('[PAINTER_LAUNCH]', JSON.stringify({ event, slot: PAINTER_APP_CONFIG.selected_data_slot, ...payload }));
}

async function validate_painter_file(path: string): Promise<boolean> {
  const api = window.electronAPI;
  if (!api?.readFile) return false;
  const res = await api.readFile(path).catch(() => null);
  if (!res?.success || typeof res.content !== 'string') return false;
  try {
    importPainterDocumentFromJSON(res.content);
    return true;
  } catch {
    try {
      importVoxelSpaceFromJSON(res.content);
      return true;
    } catch {
      return false;
    }
  }
}

function get_tai_painter_boot_file_path(): string | null {
  const config = (window as Window).electronAPI?.toolAssistedInputsBootConfig as { enabled?: boolean; painterBootFilePath?: string } | undefined;
  if (!config?.enabled) return null;
  const path = String(config.painterBootFilePath ?? '').trim();
  return path || null;
}

function is_tai_boot_enabled(): boolean {
  return Boolean((window as Window).electronAPI?.toolAssistedInputsBootConfig?.enabled);
}

export function resolve_painter_tai_join_request(): TaiJoinRequest | null {
  const config = (window as Window).electronAPI?.toolAssistedInputsBootConfig;
  if (!config?.enabled) return null;
  if (get_tai_painter_boot_file_path()) return null;
  const preferred_host = String(config.joinPreferredHost ?? '').trim() || null;
  if (preferred_host) {
    try {
      save_manual_connection(preferred_host, preferred_host);
    } catch {
      // ignore invalid host bootstrap input here; join flow will report it
    }
  }
  log_painter_launch('resolve_tai_join_request', {
    preferred_connection_id: String(config.joinPreferredConnectionId ?? '').trim() || null,
    preferred_connection_kind: String(config.joinPreferredConnectionKind ?? '').trim() || (preferred_host ? 'saved_manual' : 'local'),
    preferred_host,
    auto_join: config.joinAutoJoin !== false,
  });
  return {
    preferred_connection_id: String(config.joinPreferredConnectionId ?? '').trim() || null,
    preferred_connection_kind: (String(config.joinPreferredConnectionKind ?? '').trim() || (preferred_host ? 'saved_manual' : 'local')) as TaiJoinRequest['preferred_connection_kind'],
    preferred_host,
    auto_join: config.joinAutoJoin !== false,
  };
}

export function create_painter_launch_adapter(): LaunchAdapter<PainterLaunchIntent> {
  const slot = PAINTER_APP_CONFIG.selected_data_slot;
  return {
    title: 'PAINTING MENU',
    initial_status_lines: ['Resume opens the last valid painting file', 'New creates and hosts a new painting file'],
    async validate_resume(): Promise<ResumeValidationResult<PainterLaunchIntent>> {
      const taiBootPath = get_tai_painter_boot_file_path();
      if (taiBootPath) {
        const valid = await validate_painter_file(taiBootPath);
        if (valid) {
          log_painter_launch('validate_resume_tai_boot_file', { path: taiBootPath, resolved_intent: 'resume_file' });
          return {
            resumable: true,
            candidate: {
              app_id: APP_ID,
              slot,
              source: { kind: 'file', path: taiBootPath },
              summary: {
                title: taiBootPath.split(/[/\\]/).pop() ?? taiBootPath,
                subtitle: `TAI boot file: ${taiBootPath}`,
                updated_at_ms: null,
              },
            },
            resolved_intent: { kind: 'resume_file', slot, path: taiBootPath, persist_recent: false },
          };
        }
      }
      const record = load_launch_record(APP_ID, slot);
      const path = String(record?.resume_candidate?.file_path ?? '').trim();
      if (!path) return { resumable: false, reason: 'No recent painting file' };
      const valid = await validate_painter_file(path);
      if (!valid) return { resumable: false, reason: 'Last painting file is missing or invalid' };
      log_painter_launch('validate_resume_recent_file', { path, resolved_intent: 'resume_file' });
      return {
        resumable: true,
        candidate: {
          app_id: APP_ID,
          slot,
          source: { kind: 'file', path },
          summary: {
            title: path.split(/[/\\]/).pop() ?? path,
            subtitle: path,
            updated_at_ms: record?.last_updated_at_ms ?? null,
          },
        },
        resolved_intent: { kind: 'resume_file', slot, path },
      };
    },
    async create_new_intent(): Promise<PainterLaunchIntent> {
      log_painter_launch('create_new_intent', { resolved_intent: 'new_document' });
      return { kind: 'new_document', slot };
    },
    async create_load_intent(): Promise<PainterLaunchIntent | null> {
      const api = window.electronAPI;
      if (!api?.showOpenDialog) return null;
      const openResp = await api.showOpenDialog({
        title: 'Load Painting',
        filters: [{ name: 'JSON Files', extensions: ['json'] }],
        properties: ['openFile'],
      }).catch(() => null);
      const path = String(openResp?.filePaths?.[0] ?? '').trim();
      if (!path) return null;
      log_painter_launch('create_load_intent', { path, resolved_intent: 'load_file' });
      return { kind: 'load_file', slot, path };
    },
    async create_join_intent(entry: LaunchJoinEntry | null): Promise<PainterLaunchIntent | null> {
      const document_id = String(entry?.document_id ?? entry?.metadata?.painter_document_id ?? '').trim();
      if (!entry || !document_id) {
        debug_warn('[PAINTER_LAUNCH]', 'join requested but no local hosted painting is available', { slot });
        return null;
      }
      log_painter_launch('create_join_intent', {
        join_target_id: entry.id,
        document_id,
        display_name: entry.display_name ?? entry.label ?? 'untitled',
        resolved_intent: 'join_authoritative',
      });
      return {
        kind: 'join_authoritative',
        slot,
        document_id,
        display_name: String(entry.display_name ?? entry.label ?? 'untitled'),
        join_target_id: entry.id,
        host_boot_id: typeof entry.host_boot_id === 'string' ? entry.host_boot_id : null,
        persist_recent: false,
      };
    },
    async get_join_entries() {
      const entries = await discover_local_joinable_worlds(slot);
      return entries
        .filter((entry) => entry.painter_document_id)
        .map((entry) => ({
          id: entry.id,
          label: String(entry.painter_display_name ?? entry.label ?? 'Local Painting'),
          description: String(entry.description ?? 'join hosted local painting'),
          local: true,
          document_id: entry.painter_document_id,
          display_name: entry.painter_display_name,
          host_boot_id: entry.host_mode === 'host' ? null : null,
          metadata: {
            painter_document_id: entry.painter_document_id,
            painter_display_name: entry.painter_display_name,
            painter_file_backed: entry.painter_file_backed,
          },
        }));
    },
  };
}

export async function resolve_painter_tai_boot_intent(): Promise<PainterLaunchIntent | null> {
  const path = get_tai_painter_boot_file_path();
  if (path) {
    const valid = await validate_painter_file(path);
    if (!valid) return null;
    log_painter_launch('resolve_tai_boot_intent', { path, resolved_intent: 'resume_file' });
    return { kind: 'resume_file', slot: PAINTER_APP_CONFIG.selected_data_slot, path, persist_recent: false };
  }
  const config = (window as Window).electronAPI?.toolAssistedInputsBootConfig;
  const has_join_request = Boolean(
    String(config?.joinPreferredConnectionId ?? '').trim()
    || String(config?.joinPreferredConnectionKind ?? '').trim()
    || String(config?.joinPreferredHost ?? '').trim()
  );
  if (has_join_request) return null;
  if (is_tai_boot_enabled()) {
    log_painter_launch('resolve_tai_boot_intent', { resolved_intent: 'new_document' });
    return { kind: 'new_document', slot: PAINTER_APP_CONFIG.selected_data_slot, persist_recent: false };
  }
  return null;
}

export function persist_painter_resume_file(path: string): void {
  save_launch_record({
    version: 1,
    app_id: APP_ID,
    slot: PAINTER_APP_CONFIG.selected_data_slot,
    last_action: 'load',
    last_updated_at_ms: Date.now(),
    resume_candidate: {
      kind: 'file',
      file_path: path,
      title: path.split(/[/\\]/).pop() ?? path,
      updated_at_ms: Date.now(),
    },
  });
}
