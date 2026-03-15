export type ApiOk<T extends object = {}> = { ok: true } & T;
export type ApiErr = { ok: false; error: string; http_status?: number; detail?: any };
export type ApiResult<T extends object = {}> = ApiOk<T> | ApiErr;

export type TransferArgs = {
  transfer_base_url?: string;
  transfer_mode?: 'touch' | 'throw';
  actor_id: string;
  item_instance_id: string;
  from_container: string;
  to_container: string;
  target_grid_x?: number;
  target_grid_y?: number;
};

// Single endpoint for everything.
export async function api_transfer_inline(args: TransferArgs): Promise<ApiResult> {
  const base = args.transfer_base_url ?? 'http://localhost:8787';
  const res = await fetch(`${base}/api/transfer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      transfer_mode: args.transfer_mode,
      actor_id: args.actor_id,
      item_instance_id: args.item_instance_id,
      from_container: args.from_container,
      to_container: args.to_container,
      target_grid_x: args.target_grid_x,
      target_grid_y: args.target_grid_y,
    }),
  });
  const out = await res.json().catch(() => null as any);
  if (res.ok && out?.ok) return { ok: true };
  try {
    console.log('[api_transfer_inline] transfer failed', JSON.stringify({
      from_container: args.from_container,
      to_container: args.to_container,
      item_instance_id: args.item_instance_id,
      error: out?.error || `HTTP ${res.status}`,
      detail: out?.detail,
      http_status: res.status,
    }));
  } catch {
    // ignore
  }
  return { ok: false, error: out?.error || `HTTP ${res.status}`, http_status: res.status, detail: out?.detail };
}
