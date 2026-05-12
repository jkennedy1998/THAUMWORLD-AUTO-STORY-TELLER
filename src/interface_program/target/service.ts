import { clearActorTarget, setActorTarget } from "../target_state.js";

export type TargetSelectionType = "npc" | "actor" | "item" | "terrain";

export interface ApplyActorTargetSelectionInput {
  actor_ref: string;
  target_ref: string | null | undefined;
  target_type?: TargetSelectionType;
  target_name?: string;
}

export type ApplyActorTargetSelectionResult =
  | {
      ok: true;
      action: "cleared";
      actor_ref: string;
    }
  | {
      ok: true;
      action: "set";
      actor_ref: string;
      target_ref: string;
      target_type: TargetSelectionType;
    };

export function applyActorTargetSelection(
  input: ApplyActorTargetSelectionInput,
): ApplyActorTargetSelectionResult {
  const actor_ref = String(input.actor_ref ?? "").trim();
  const target_ref = typeof input.target_ref === "string" ? input.target_ref.trim() : "";

  if (!target_ref) {
    clearActorTarget(actor_ref);
    return {
      ok: true,
      action: "cleared",
      actor_ref,
    };
  }

  const target_type: TargetSelectionType = input.target_type ?? "npc";
  setActorTarget(actor_ref, target_ref, target_type, input.target_name);

  return {
    ok: true,
    action: "set",
    actor_ref,
    target_ref,
    target_type,
  };
}
