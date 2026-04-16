import type { AutomationScriptRepository, ToolAssistedInputsScript } from './automation_interfaces.js';
import { parse_tool_assisted_inputs_script } from './automation_script_schema.js';

const ENABLED_KEY = 'tool_assisted_inputs_enabled';
const SCRIPT_PATH_KEY = 'tool_assisted_inputs_script_path';

function get_boot_script_path(): string | null {
  const config = (window as Window).electronAPI?.toolAssistedInputsBootConfig;
  if (!config?.enabled) return null;
  const script_path = String(config.scriptPath ?? '').trim();
  return script_path || null;
}

function get_query_param(name: string): string | null {
  try {
    const url = new URL(window.location.href);
    const value = String(url.searchParams.get(name) ?? '').trim();
    return value || null;
  } catch {
    return null;
  }
}

export function create_tool_assisted_inputs_script_repository_local(_data_slot: number): AutomationScriptRepository {
  async function resolve_script_path(script_ref: string): Promise<string> {
    const ref = String(script_ref ?? '').trim();
    if (!ref) throw new Error('tool_assisted_inputs_missing_script_ref');
    if (/^[A-Za-z]:[\\/]/.test(ref) || ref.startsWith('\\\\')) return ref;
    const boot_script = get_boot_script_path();
    if (boot_script) {
      const normalized = boot_script.replace(/\\/g, '/');
      const last_slash = normalized.lastIndexOf('/');
      if (last_slash >= 0) {
        return `${normalized.slice(0, last_slash)}/${ref.replace(/\\/g, '/')}`;
      }
    }
    throw new Error('tool_assisted_inputs_relative_path_requires_boot_config');
  }

  return {
    async get_autostart_script_ref(): Promise<string | null> {
      const boot_script = get_boot_script_path();
      if (boot_script) return boot_script;
      const query_script = get_query_param('tai_script');
      const query_enabled = get_query_param('tai');
      if (query_script && query_enabled !== '0') return query_script;
      return null;
    },
    async set_last_script_ref(script_ref: string): Promise<void> {
      window.localStorage.setItem(SCRIPT_PATH_KEY, script_ref);
      window.localStorage.setItem(ENABLED_KEY, 'true');
    },
    async load_script(script_ref: string): Promise<{ script: ToolAssistedInputsScript; resolved_ref: string }> {
      const resolved_ref = await resolve_script_path(script_ref);
      const response = await (window as Window).electronAPI?.readFile?.(resolved_ref);
      if (!response?.success || typeof response.content !== 'string') {
        throw new Error(String(response?.error ?? 'tool_assisted_inputs_read_failed'));
      }
      return {
        script: parse_tool_assisted_inputs_script(response.content),
        resolved_ref,
      };
    },
  };
}
