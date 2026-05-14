import { project_spoil_period_breaths } from '../mag/lifecycle.js';
import { build_spoils_tag_config } from '../tag_system/spoils.js';
import { resolve_tag_state_from_instance } from '../tag_system/resolved.js';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function test_spoil_period_direction(): void {
  assert(project_spoil_period_breaths(0) === 300, `expected mag 0 to spoil in 300 breaths, got ${project_spoil_period_breaths(0)}`);
  assert(project_spoil_period_breaths(1) === 150, `expected mag 1 to spoil faster in 150 breaths, got ${project_spoil_period_breaths(1)}`);
  assert(project_spoil_period_breaths(2) === 75, `expected mag 2 to spoil faster in 75 breaths, got ${project_spoil_period_breaths(2)}`);
  assert(project_spoil_period_breaths(-1) === 600, `expected mag -1 to spoil slower in 600 breaths, got ${project_spoil_period_breaths(-1)}`);
}

function test_spoils_config_resolution(): void {
  const state = resolve_tag_state_from_instance({
    name: 'SPOILS',
    mag: 1,
    dim_mag: { spoil_time_mag: 2 },
    info: { result_item_def_id: 'mush' },
  } as any);
  const config = build_spoils_tag_config(state);
  assert(config !== null, 'expected SPOILS config to resolve');
  assert(config?.period_breaths === 75, `expected spoil period 75, got ${config?.period_breaths}`);
  assert(config?.result_item_def_id === 'mush', `expected result_item_def_id=mush, got ${String(config?.result_item_def_id)}`);
}

async function main(): Promise<void> {
  test_spoil_period_direction();
  test_spoils_config_resolution();
  console.log('spoils_diagnostics.test.ts: ok');
}

void main().catch((error) => {
  console.error('spoils_diagnostics.test.ts: failed');
  console.error(error);
  process.exit(1);
});
