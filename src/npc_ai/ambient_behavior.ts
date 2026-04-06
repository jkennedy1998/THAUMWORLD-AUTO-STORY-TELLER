import { get_configured_data_slot } from "../shared/boot_env.js";
import { debug_log } from "../shared/debug.js";
import { load_npc } from "../npc_storage/store.js";
import { should_behavior_auto_wander } from "./behavior.js";

const data_slot = get_configured_data_slot();
const ambient_resume_timeouts = new Map<string, ReturnType<typeof setTimeout>>();

function clear_resume_timeout(npc_ref: string): void {
  const timeout_id = ambient_resume_timeouts.get(npc_ref);
  if (!timeout_id) return;
  clearTimeout(timeout_id);
  ambient_resume_timeouts.delete(npc_ref);
}

function npc_can_resume_ambient_wander(npc_ref: string): boolean {
  const npc_id = npc_ref.replace(/^npc\./, "");
  const npc_result = load_npc(data_slot, npc_id);
  if (!npc_result.ok) return false;
  return should_behavior_auto_wander(npc_ref, npc_result.npc);
}

export function cancel_npc_ambient_behavior(npc_ref: string): void {
  clear_resume_timeout(npc_ref);
  debug_log("NPC_BEHAVIOR", `${npc_ref} cancelled pending ambient routine resume`);
}

export function resume_npc_ambient_behavior(npc_ref: string): void {
  clear_resume_timeout(npc_ref);
  if (!npc_can_resume_ambient_wander(npc_ref)) {
    debug_log("NPC_BEHAVIOR", `${npc_ref} ambient routine resume skipped - behavior does not auto-wander`);
    return;
  }

  const timeout_id = setTimeout(() => {
    ambient_resume_timeouts.delete(npc_ref);
    debug_log("NPC_BEHAVIOR", `${npc_ref} ambient routine resume ready; authoritative goal selection may assign next goal`);
  }, 1000);
  ambient_resume_timeouts.set(npc_ref, timeout_id);
  debug_log("NPC_BEHAVIOR", `${npc_ref} scheduled ambient routine resume after interruption`);
}
