import { start_conversation, is_in_conversation, update_conversations } from "../../src/npc_ai/conversation_state.js";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  const npc_ref = "npc.test_npc";
  const actor_ref = "actor.test_actor";

  const original_now = Date.now;
  try {
    // Start at a deterministic time.
    let now = 1_000_000;
    Date.now = () => now;

    const conv_id = start_conversation(npc_ref, actor_ref, [npc_ref, actor_ref], null, null);
    assert(typeof conv_id === "string" && conv_id.length > 0, "start_conversation should return id");
    assert(is_in_conversation(npc_ref) === true, "npc should be in conversation after start");

    // Before timeout, should not end.
    now += 10_000;
    const ended0 = update_conversations();
    assert(Array.isArray(ended0) && ended0.length === 0, "conversation should not end before timeout");
    assert(is_in_conversation(npc_ref) === true, "npc should still be in conversation before timeout");

    // After timeout window (30s), should end.
    now += 31_000;
    const ended1 = update_conversations();
    assert(ended1.length === 1, "one conversation should end after timeout");
    assert(ended1[0]?.npc_ref === npc_ref, "ended conversation should reference npc");
    assert(is_in_conversation(npc_ref) === false, "npc should not be in conversation after timeout");
  } finally {
    Date.now = original_now;
  }
}

main().catch((err) => {
  console.error("conversation_lifecycle eval failed:", err);
  process.exit(1);
});
