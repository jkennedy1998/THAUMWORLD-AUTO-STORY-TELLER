type RendererErrorPayload = {
  message: string;
  stack?: string | null;
  source?: string | null;
  line?: number | null;
  column?: number | null;
  app_mode?: string | null;
  client_instance_id?: string | null;
};

function get_renderer_boot_metadata(): { app_mode: string | null; client_instance_id: string | null } {
  const api = (window as any).electronAPI;
  return {
    app_mode: typeof api?.appMode === 'string' ? api.appMode : null,
    client_instance_id: typeof api?.clientInstanceId === 'string' ? api.clientInstanceId : null,
  };
}

function log_renderer_boot_error(tag: string, payload: RendererErrorPayload): void {
  try {
    console.error(`[RENDERER_BOOT][${tag}] ${JSON.stringify(payload)}`);
  } catch {
    console.error(`[RENDERER_BOOT][${tag}]`, payload);
  }
}

window.addEventListener('error', (event) => {
  const error = event.error instanceof Error ? event.error : null;
  log_renderer_boot_error('window_error', {
    message: String(error?.message ?? event.message ?? 'unknown window error'),
    stack: error?.stack ?? null,
    source: event.filename || null,
    line: typeof event.lineno === 'number' ? event.lineno : null,
    column: typeof event.colno === 'number' ? event.colno : null,
    ...get_renderer_boot_metadata(),
  });
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  const error = reason instanceof Error ? reason : null;
  log_renderer_boot_error('unhandled_rejection', {
    message: String(error?.message ?? reason ?? 'unknown rejection'),
    stack: error?.stack ?? null,
    ...get_renderer_boot_metadata(),
  });
});

log_renderer_boot_error('bootstrap_start', {
  message: 'importing renderer entry',
  ...get_renderer_boot_metadata(),
});

void import('./main.js').catch((error) => {
  const err = error instanceof Error ? error : null;
  log_renderer_boot_error('import_failure', {
    message: String(err?.message ?? error ?? 'unknown import failure'),
    stack: err?.stack ?? null,
    ...get_renderer_boot_metadata(),
  });
});
