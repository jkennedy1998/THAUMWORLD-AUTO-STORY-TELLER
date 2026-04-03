export type HostStatus = {
  ok: true;
  slot: number;
  host_boot_id: string;
  world_label: string;
  host_mode: string;
  join_mode: string;
  supports_join: boolean;
  services: string[];
};

export type JoinableWorldEntry = {
  id: string;
  label: string;
  description?: string;
  local?: boolean;
  host_mode?: string;
  join_mode?: string;
  services?: string[];
};

async function fetch_json(url: string): Promise<any | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function fetch_local_host_status(slot: number): Promise<HostStatus | null> {
  const data = await fetch_json(`http://localhost:8787/api/host/status?slot=${encodeURIComponent(String(slot))}`);
  if (!data?.ok) return null;
  return data as HostStatus;
}

export async function discover_local_joinable_worlds(slot: number): Promise<JoinableWorldEntry[]> {
  const status = await fetch_local_host_status(slot);
  if (!status) return [];
  return [{
    id: `local:${String(status.slot)}`,
    label: String(status.world_label ?? `Local World Slot ${slot}`),
    description: `local host ${String(status.host_mode ?? 'host')} - ${String(status.join_mode ?? 'join enabled')}`,
    local: true,
    host_mode: String(status.host_mode ?? 'host'),
    join_mode: String(status.join_mode ?? 'join enabled'),
    services: Array.isArray(status.services) ? status.services.map((entry: any) => String(entry)) : [],
  }];
}

export async function discover_joinable_worlds(slot: number): Promise<JoinableWorldEntry[]> {
  const local = await discover_local_joinable_worlds(slot);
  return local;
}
