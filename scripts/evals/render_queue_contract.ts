import { select_flash_index } from "../../src/render_shaders/render_queue.js";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  // Deterministic flashing: same inputs => same index.
  assert(select_flash_index(0, 3, 250) === 0, "phase 0");
  assert(select_flash_index(249, 3, 250) === 0, "still phase 0");
  assert(select_flash_index(250, 3, 250) === 1, "phase 1");
  assert(select_flash_index(500, 3, 250) === 2, "phase 2");
  assert(select_flash_index(750, 3, 250) === 0, "wraps");
  console.log("render_queue_contract eval passed");
}

main().catch((err) => {
  console.error("render_queue_contract eval failed:", err);
  process.exit(1);
});
