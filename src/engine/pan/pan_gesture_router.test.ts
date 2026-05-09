import * as assert from 'node:assert/strict';
import { create_pan_gesture_router } from './pan_gesture_router.js';
import type { IPanTargetAdapter } from './pan_target.js';

function makeTarget(kind: ReturnType<IPanTargetAdapter['getKind']>): IPanTargetAdapter {
  return {
    getKind: () => kind,
    getCapabilities: () => ({ axes: { x: true }, space: 'module_cells', motion_style: { kind: 'snap' } }),
  };
}

const moduleTarget = makeTarget('module_2d');
const viewportTarget = makeTarget('viewport');

const router = create_pan_gesture_router<{ id: string }>({
  resolveModuleTarget: (module) => module?.id === 'module' ? moduleTarget : null,
  resolveViewportTarget: () => viewportTarget,
});

assert.equal(router.resolveTarget({ module: { id: 'module' }, prefer_module_target: true, allow_viewport_fallback: true }), moduleTarget);
assert.equal(router.resolveTarget({ module: null, prefer_module_target: false, allow_viewport_fallback: true }), viewportTarget);
assert.equal(router.resolveTarget({ module: { id: 'other' }, prefer_module_target: true, allow_viewport_fallback: false }), null);

console.log('pan_gesture_router.test.ts passed');
