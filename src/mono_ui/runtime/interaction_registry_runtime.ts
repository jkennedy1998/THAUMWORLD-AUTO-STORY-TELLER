import type { InteractionConsumerAdapters, ResolutionAdapterInput } from './interaction_capabilities_runtime.js';
import { begin_interaction_session, create_hover_state, end_interaction_session, update_interaction_session } from './interaction_orchestrator_runtime.js';
import type { InteractionHoverState, InteractionKind, InteractionPointerState, InteractionSession } from './interaction_session_runtime.js';
import { order_resolved_targets } from './interaction_resolution_runtime.js';
import type { OrderedResolvedTargets } from './interaction_target_runtime.js';
import type { ViewInstance } from './interaction_view_runtime.js';

export type RegisteredInteractionConsumer = {
  consumer_id: string;
  adapters: InteractionConsumerAdapters;
};

export type InteractionHoverResolution = {
  consumer_id: string;
  view: ViewInstance;
  hover: InteractionHoverState;
  resolved_targets: OrderedResolvedTargets;
};

export type InteractionSessionResolution = {
  consumer_id: string;
  view: ViewInstance;
  session: InteractionSession;
};

export type InteractionPointerMoveResolution = {
  hover: InteractionHoverResolution | null;
  session: InteractionSessionResolution | null;
};

export type InteractionPointerDownResolution = {
  session: InteractionSessionResolution | null;
};

export type InteractionPointerUpResolution = {
  session: InteractionSessionResolution | null;
};

export type InteractionConsumerMap = Record<string, InteractionConsumerAdapters | null | undefined>;

function point_in_rect(view: ViewInstance, x: number, y: number): boolean {
  const rect = view.viewport_rect;
  return x >= rect.x0 && x <= rect.x1 && y >= rect.y0 && y <= rect.y1;
}

function compare_views(a: { consumer_id: string; view: ViewInstance }, b: { consumer_id: string; view: ViewInstance }): number {
  const hitPriorityDiff = (b.view.hit_test_priority ?? 0) - (a.view.hit_test_priority ?? 0);
  if (hitPriorityDiff !== 0) return hitPriorityDiff;
  const zIndexDiff = (b.view.z_index ?? 0) - (a.view.z_index ?? 0);
  if (zIndexDiff !== 0) return zIndexDiff;
  return a.consumer_id.localeCompare(b.consumer_id);
}

export function create_interaction_registry_runtime() {
  const consumers = new Map<string, InteractionConsumerAdapters>();
  let active_session_resolution: InteractionSessionResolution | null = null;

  function register_consumer(consumer_id: string, adapters: InteractionConsumerAdapters): void {
    consumers.set(consumer_id, adapters);
  }

  function unregister_consumer(consumer_id: string): void {
    consumers.delete(consumer_id);
  }

  function clear_consumers(): void {
    consumers.clear();
  }

  function sync_consumers(next_consumers: InteractionConsumerMap): void {
    consumers.clear();
    for (const [consumer_id, adapters] of Object.entries(next_consumers)) {
      if (!adapters) continue;
      consumers.set(consumer_id, adapters);
    }
  }

  function list_consumers(): RegisteredInteractionConsumer[] {
    return Array.from(consumers.entries()).map(([consumer_id, adapters]) => ({ consumer_id, adapters }));
  }

  function collect_views(): Array<{ consumer_id: string; adapters: InteractionConsumerAdapters; view: ViewInstance }> {
    const views: Array<{ consumer_id: string; adapters: InteractionConsumerAdapters; view: ViewInstance }> = [];
    for (const [consumer_id, adapters] of consumers.entries()) {
      for (const view of adapters.view_registration.get_view_instances()) {
        views.push({ consumer_id, adapters, view });
      }
    }
    return views;
  }

  function resolve_hover(pointer: InteractionPointerState): InteractionHoverResolution | null {
    const hits = collect_views()
      .filter(({ view }) => point_in_rect(view, pointer.x, pointer.y))
      .sort(compare_views);
    const selected = hits[0] ?? null;
    if (!selected) return null;
    const resolvedTargets = selected.adapters.resolution?.resolve_targets({
      module_id: selected.view.module_id,
      view_id: selected.view.view_id,
      pointer,
    } satisfies ResolutionAdapterInput) ?? order_resolved_targets([]);
    const hover = create_hover_state(pointer, resolvedTargets);
    selected.adapters.session_handler?.update_hover?.(hover);
    return {
      consumer_id: selected.consumer_id,
      view: selected.view,
      hover,
      resolved_targets: resolvedTargets,
    };
  }

  function begin_active_session(args: {
    pointer: InteractionPointerState;
    interaction_kind?: InteractionKind;
    metadata?: Record<string, unknown>;
  }): InteractionSessionResolution | null {
    const hover = resolve_hover(args.pointer);
    if (!hover) {
      active_session_resolution = null;
      return null;
    }
    const adapters = consumers.get(hover.consumer_id);
    if (!adapters) return null;
    const session = begin_interaction_session({
      session_id: `${hover.consumer_id}:${Date.now()}`,
      interaction_kind: args.interaction_kind ?? 'drag',
      source_module_id: hover.view.module_id,
      source_view_id: hover.view.view_id,
      pointer: args.pointer,
      resolved_targets: hover.resolved_targets,
      metadata: args.metadata,
      started_at_ms: args.pointer.timestamp_ms,
    });
    adapters.session_handler?.begin_interaction?.(session);
    active_session_resolution = {
      consumer_id: hover.consumer_id,
      view: hover.view,
      session,
    };
    return active_session_resolution;
  }

  function update_active_session(pointer: InteractionPointerState): InteractionSessionResolution | null {
    if (!active_session_resolution) return null;
    const adapters = consumers.get(active_session_resolution.consumer_id);
    if (!adapters) return null;
    const resolved_targets = adapters.resolution?.resolve_targets({
      module_id: active_session_resolution.view.module_id,
      view_id: active_session_resolution.view.view_id,
      pointer,
    } satisfies ResolutionAdapterInput) ?? order_resolved_targets([]);
    const session = update_interaction_session(active_session_resolution.session, {
      pointer,
      resolved_targets,
      updated_at_ms: pointer.timestamp_ms,
      status: 'active',
    });
    adapters.session_handler?.update_interaction?.(session);
    active_session_resolution = {
      ...active_session_resolution,
      session,
    };
    return active_session_resolution;
  }

  function end_active_session(pointer: InteractionPointerState): InteractionSessionResolution | null {
    if (!active_session_resolution) return null;
    const adapters = consumers.get(active_session_resolution.consumer_id);
    if (!adapters) return null;
    const resolved_targets = adapters.resolution?.resolve_targets({
      module_id: active_session_resolution.view.module_id,
      view_id: active_session_resolution.view.view_id,
      pointer,
    } satisfies ResolutionAdapterInput) ?? order_resolved_targets([]);
    const session = end_interaction_session(active_session_resolution.session, {
      pointer,
      resolved_targets,
      ended_at_ms: pointer.timestamp_ms,
    });
    adapters.session_handler?.end_interaction?.(session);
    active_session_resolution = {
      ...active_session_resolution,
      session,
    };
    return active_session_resolution;
  }

  function clear_active_session(): void {
    active_session_resolution = null;
  }

  function get_active_session(): InteractionSessionResolution | null {
    return active_session_resolution;
  }

  function process_pointer_move(pointer: InteractionPointerState): InteractionPointerMoveResolution {
    const hover = resolve_hover(pointer);
    const session = update_active_session(pointer) ?? active_session_resolution;
    return { hover, session };
  }

  function sync_consumers_and_process_pointer_move(next_consumers: InteractionConsumerMap, pointer: InteractionPointerState): InteractionPointerMoveResolution {
    sync_consumers(next_consumers);
    return process_pointer_move(pointer);
  }

  function process_pointer_down(pointer: InteractionPointerState, interaction_kind: InteractionKind = 'drag', metadata?: Record<string, unknown>): InteractionPointerDownResolution {
    const session = begin_active_session({ pointer, interaction_kind, metadata });
    return { session };
  }

  function sync_consumers_and_process_pointer_down(next_consumers: InteractionConsumerMap, pointer: InteractionPointerState, interaction_kind: InteractionKind = 'drag', metadata?: Record<string, unknown>): InteractionPointerDownResolution {
    sync_consumers(next_consumers);
    return process_pointer_down(pointer, interaction_kind, metadata);
  }

  function process_pointer_up(pointer: InteractionPointerState): InteractionPointerUpResolution {
    const session = end_active_session(pointer);
    return { session };
  }

  function sync_consumers_and_process_pointer_up(next_consumers: InteractionConsumerMap, pointer: InteractionPointerState): InteractionPointerUpResolution {
    sync_consumers(next_consumers);
    return process_pointer_up(pointer);
  }

  return {
    register_consumer,
    unregister_consumer,
    clear_consumers,
    sync_consumers,
    list_consumers,
    collect_views,
    resolve_hover,
    begin_active_session,
    update_active_session,
    end_active_session,
    clear_active_session,
    get_active_session,
    process_pointer_move,
    sync_consumers_and_process_pointer_move,
    process_pointer_down,
    sync_consumers_and_process_pointer_down,
    process_pointer_up,
    sync_consumers_and_process_pointer_up,
  };
}
