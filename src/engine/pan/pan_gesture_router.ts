import type { IPanTargetAdapter } from './pan_target.js';

export type PanGestureResolveContext<TModule = unknown> = {
  module: TModule | null;
  prefer_module_target: boolean;
  allow_viewport_fallback: boolean;
};

export interface IPanGestureRouter<TModule = unknown> {
  resolveTarget(ctx: PanGestureResolveContext<TModule>): IPanTargetAdapter | null;
}

export function create_pan_gesture_router<TModule>(opts: {
  resolveModuleTarget: (module: TModule | null) => IPanTargetAdapter | null;
  resolveViewportTarget: () => IPanTargetAdapter | null;
}): IPanGestureRouter<TModule> {
  return {
    resolveTarget(ctx) {
      if (ctx.prefer_module_target) {
        const moduleTarget = opts.resolveModuleTarget(ctx.module);
        if (moduleTarget) return moduleTarget;
      }
      if (ctx.allow_viewport_fallback) {
        return opts.resolveViewportTarget();
      }
      return null;
    },
  };
}
