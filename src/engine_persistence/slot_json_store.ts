export async function get_slot_relative_file_path(slot: number, relative_path: string): Promise<string> {
  const api = window.electronAPI;
  if (!api?.getDataSlotDir) throw new Error('electronAPI.getDataSlotDir unavailable');
  const slot_dir = await api.getDataSlotDir(slot);
  return `${String(slot_dir).replace(/[\\/]+$/, '')}/${String(relative_path).replace(/^[\\/]+/, '')}`;
}

export async function get_slot_json_file_path(slot: number, file_name: string): Promise<string> {
  return get_slot_relative_file_path(slot, file_name);
}

export async function read_slot_relative_json_file<T>(slot: number, relative_path: string): Promise<{ file_path: string; data: T | null; error: string | null }> {
  const api = window.electronAPI;
  if (!api?.readFile) throw new Error('electronAPI.readFile unavailable');
  const file_path = await get_slot_relative_file_path(slot, relative_path);
  const response = await api.readFile(file_path).catch(() => null);
  if (!response?.success || typeof response.content !== 'string') {
    return {
      file_path,
      data: null,
      error: String(response?.error ?? 'missing_or_unreadable_file'),
    };
  }
  try {
    return {
      file_path,
      data: JSON.parse(response.content) as T,
      error: null,
    };
  } catch (error) {
    return {
      file_path,
      data: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function read_slot_json_file<T>(slot: number, file_name: string): Promise<{ file_path: string; data: T | null; error: string | null }> {
  return read_slot_relative_json_file<T>(slot, file_name);
}

export async function write_slot_relative_json_file(slot: number, relative_path: string, value: unknown): Promise<{ file_path: string }> {
  const api = window.electronAPI;
  if (!api?.writeFileAtomic) throw new Error('electronAPI.writeFileAtomic unavailable');
  const file_path = await get_slot_relative_file_path(slot, relative_path);
  const response = await api.writeFileAtomic(file_path, JSON.stringify(value, null, 2)).catch((error: unknown) => ({ success: false, error: error instanceof Error ? error.message : String(error) }));
  if (!response?.success) {
    throw new Error(String(response?.error ?? 'slot_json_write_failed'));
  }
  return { file_path };
}

export async function write_slot_json_file(slot: number, file_name: string, value: unknown): Promise<{ file_path: string }> {
  return write_slot_relative_json_file(slot, file_name, value);
}
