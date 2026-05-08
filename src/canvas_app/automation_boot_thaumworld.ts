import type { ActorClaimEntry } from '../mono_ui/modules/actor_claim_module.js';
import type { ToolAssistedInputsBootOptions, ToolAssistedInputsContext, WorldSessionBootstrap } from '../mono_ui/runtime/automation_interfaces.js';

type ThaumworldBootstrapOptions = {
  ensure_multiplayer_session_bootstrap: (force?: boolean) => Promise<void>;
  resolve_controlled_actor_binding: (force?: boolean) => Promise<{ kind: 'bound' | 'unbound' | 'binding_required'; error?: string | null }>;
  refresh_actor_claim_state: (status_lines?: string[]) => Promise<void>;
  claim_actor: (actor_ref: string) => Promise<void>;
  claim_actor_by_id: (actor_id: string) => Promise<{ ok: boolean; reason?: string }>;
  get_actor_claim_entries: () => ActorClaimEntry[];
  get_current_context: () => ToolAssistedInputsContext;
};

function get_requested_actor(entries: ActorClaimEntry[], opts?: ToolAssistedInputsBootOptions): ActorClaimEntry | null {
  const actor_ref = String(opts?.actor_ref ?? '').trim();
  if (!actor_ref) return null;
  return entries.find((entry) => String(entry.actor_ref ?? '').trim() === actor_ref) ?? null;
}

async function wait_for_context(get_current_context: () => ToolAssistedInputsContext, timeout_ms: number): Promise<ToolAssistedInputsContext> {
  const started = Date.now();
  while ((Date.now() - started) < timeout_ms) {
    const context = get_current_context();
    if (context.session_token && context.actor_ref && context.place_id) return context;
    await new Promise((resolve) => window.setTimeout(resolve, 100));
  }
  return get_current_context();
}

export function create_thaumworld_bootstrap_adapter(options: ThaumworldBootstrapOptions): WorldSessionBootstrap {
  return {
    get_current_context(): ToolAssistedInputsContext {
      return options.get_current_context();
    },
    async ensure_ready(boot_options: ToolAssistedInputsBootOptions = {}): Promise<ToolAssistedInputsContext> {
      let context = options.get_current_context();
      if (boot_options.auto_connect !== false && !context.session_token) {
        await options.ensure_multiplayer_session_bootstrap(true);
      }
      await options.resolve_controlled_actor_binding(true);
      context = await wait_for_context(options.get_current_context, 1500);
      if (context.session_token && context.actor_ref && context.place_id) return context;

      if (boot_options.auto_claim) {
        const requested_actor_id = String(boot_options.actor_id ?? '').trim();
        if (requested_actor_id) {
          const claim = await options.claim_actor_by_id(requested_actor_id);
          if (!claim.ok) throw new Error(`tool_assisted_inputs_actor_id_claim_failed:${claim.reason ?? 'unknown'}`);
        } else {
        const requested_actor_ref = String(boot_options.actor_ref ?? '').trim();
        if (!requested_actor_ref) throw new Error('tool_assisted_inputs_missing_boot_actor_ref');
        await options.refresh_actor_claim_state(['tool assisted inputs', 'claiming actor']);
        const choice = get_requested_actor(options.get_actor_claim_entries(), boot_options);
        if (!choice) throw new Error('tool_assisted_inputs_actor_not_found');
        if (!choice.can_claim) throw new Error('tool_assisted_inputs_actor_not_claimable');
        await options.claim_actor(choice.actor_ref);
        }
      }

      context = await wait_for_context(options.get_current_context, 6000);
      if (!context.session_token) throw new Error('tool_assisted_inputs_missing_session_token');
      if (!context.actor_ref) throw new Error('tool_assisted_inputs_missing_actor_ref');
      if (!context.place_id) throw new Error('tool_assisted_inputs_missing_place_id');
      return context;
    },
  };
}
