import assert from 'node:assert/strict';

import {
  build_interaction_pointer_state,
  build_view_instance,
  create_interaction_registry_runtime,
  order_resolved_targets,
  select_current_resolved_target,
  select_current_resolved_target_of_type,
  type InteractionConsumerAdapters,
  type ResolvedTarget,
} from './interaction_runtime_types.js';

function makeTarget(args: {
  module_id: string;
  view_id: string;
  target_type: ResolvedTarget['target_type'];
  target_ref: string;
  x: number;
  y: number;
  z?: number;
  priority?: number;
}): ResolvedTarget {
  const z = args.z ?? 0;
  if (args.target_type === 'place_tile') {
    return {
      module_id: args.module_id,
      view_id: args.view_id,
      domain: 'hybrid',
      target_type: 'place_tile',
      target_ref: args.target_ref,
      tile_position: { x: args.x, y: args.y },
      local_position: { x: args.x, y: args.y },
      world_position: { x: args.x, y: args.y, z },
      priority: args.priority,
    };
  }
  if (args.target_type === 'inventory_slot') {
    return {
      module_id: args.module_id,
      view_id: args.view_id,
      domain: 'grid_2d',
      target_type: 'inventory_slot',
      target_ref: args.target_ref,
      container_id: 'container.test',
      slot_index: args.x,
      local_position: { x: args.x, y: args.y },
      priority: args.priority,
    };
  }
  return {
    module_id: args.module_id,
    view_id: args.view_id,
    domain: 'hybrid',
    target_type: 'painter_cell',
    target_ref: args.target_ref,
    grid_position: { x: args.x, y: args.y },
    local_position: { x: args.x, y: args.y },
    world_position: { x: args.x, y: args.y, z },
    priority: args.priority,
  };
}

function makeConsumer(args: {
  consumer_id: string;
  module_id: string;
  view_id: string;
  rect: { x0: number; y0: number; x1: number; y1: number };
  hit_test_priority?: number;
  resolved_targets: () => ResolvedTarget[];
  hover_log?: string[];
  session_log?: string[];
}): InteractionConsumerAdapters {
  const view = build_view_instance({
    module_id: args.module_id,
    view_id: args.view_id,
    space_kind: 'hybrid',
    viewport_rect: args.rect,
    hit_test_priority: args.hit_test_priority,
    capabilities: {
      resolves_2d_targets: true,
      resolves_3d_targets: true,
    },
  });
  return {
    view_registration: {
      get_view_instances: () => [view],
    },
    resolution: {
      resolve_targets: () => order_resolved_targets(args.resolved_targets()),
    },
    session_handler: {
      update_hover: (hover) => {
        args.hover_log?.push(`${args.consumer_id}:${hover.resolved_targets.primary?.target_ref ?? 'none'}`);
      },
      begin_interaction: (session) => {
        args.session_log?.push(`${args.consumer_id}:begin:${session.resolved_current_target?.target_ref ?? 'none'}`);
      },
      update_interaction: (session) => {
        args.session_log?.push(`${args.consumer_id}:update:${session.resolved_current_target?.target_ref ?? 'none'}`);
      },
      end_interaction: (session) => {
        args.session_log?.push(`${args.consumer_id}:end:${session.resolved_end_target?.target_ref ?? 'none'}`);
      },
    },
  };
}

function testHoverPrefersHighestPriorityView(): void {
  const registry = create_interaction_registry_runtime();
  const hoverLog: string[] = [];
  registry.sync_consumers({
    low: makeConsumer({
      consumer_id: 'low',
      module_id: 'low_mod',
      view_id: 'low_view',
      rect: { x0: 0, y0: 0, x1: 10, y1: 10 },
      hit_test_priority: 1,
      resolved_targets: () => [makeTarget({ module_id: 'low_mod', view_id: 'low_view', target_type: 'painter_cell', target_ref: 'low', x: 1, y: 1 })],
      hover_log: hoverLog,
    }),
    high: makeConsumer({
      consumer_id: 'high',
      module_id: 'high_mod',
      view_id: 'high_view',
      rect: { x0: 0, y0: 0, x1: 10, y1: 10 },
      hit_test_priority: 5,
      resolved_targets: () => [makeTarget({ module_id: 'high_mod', view_id: 'high_view', target_type: 'place_tile', target_ref: 'high', x: 2, y: 2 })],
      hover_log: hoverLog,
    }),
  });

  const hover = registry.resolve_hover(build_interaction_pointer_state({ x: 5, y: 5 }));
  assert.ok(hover, 'expected hover resolution');
  assert.equal(hover.consumer_id, 'high');
  assert.equal(hover.resolved_targets.primary?.target_ref, 'high');
  assert.deepEqual(hoverLog, ['high:high']);
}

function testActiveSessionTracksResolvedTargets(): void {
  const registry = create_interaction_registry_runtime();
  const sessionLog: string[] = [];
  let targetRef = 'tile_a';
  registry.sync_consumers({
    place: makeConsumer({
      consumer_id: 'place',
      module_id: 'place',
      view_id: 'place_view',
      rect: { x0: 0, y0: 0, x1: 20, y1: 20 },
      resolved_targets: () => [makeTarget({ module_id: 'place', view_id: 'place_view', target_type: 'place_tile', target_ref: targetRef, x: 3, y: 4, z: 1 })],
      session_log: sessionLog,
    }),
  });

  const down = registry.process_pointer_down(build_interaction_pointer_state({ x: 4, y: 4 }), 'drag');
  assert.ok(down.session, 'expected active session on pointer down');
  assert.equal(down.session?.session.resolved_current_target?.target_ref, 'tile_a');

  targetRef = 'tile_b';
  const move = registry.process_pointer_move(build_interaction_pointer_state({ x: 6, y: 6 }));
  assert.equal(move.session?.session.resolved_current_target?.target_ref, 'tile_b');

  const up = registry.process_pointer_up(build_interaction_pointer_state({ x: 6, y: 6 }));
  assert.equal(up.session?.session.resolved_end_target?.target_ref, 'tile_b');
  assert.deepEqual(sessionLog, [
    'place:begin:tile_a',
    'place:update:tile_b',
    'place:end:tile_b',
  ]);
}

function testOrderedTargetPriority(): void {
  const ordered = order_resolved_targets([
    makeTarget({ module_id: 'mod', view_id: 'view', target_type: 'inventory_slot', target_ref: 'slot', x: 0, y: 0, priority: 10 }),
    makeTarget({ module_id: 'mod', view_id: 'view', target_type: 'place_tile', target_ref: 'tile', x: 0, y: 0, priority: 1 }),
  ]);
  assert.equal(ordered.primary?.target_ref, 'tile');
  assert.deepEqual(ordered.ordered.map((target) => target.target_ref), ['tile', 'slot']);
}

function testHoverSelectsAcrossConsumerFamilies(): void {
  const registry = create_interaction_registry_runtime();
  registry.sync_consumers({
    painter: makeConsumer({
      consumer_id: 'painter',
      module_id: 'painter_canvas',
      view_id: 'painter_view',
      rect: { x0: 0, y0: 0, x1: 20, y1: 20 },
      hit_test_priority: 1,
      resolved_targets: () => [
        makeTarget({ module_id: 'painter_canvas', view_id: 'painter_view', target_type: 'painter_cell', target_ref: 'painter_cell', x: 3, y: 3, priority: 5 }),
      ],
    }),
    place: makeConsumer({
      consumer_id: 'place',
      module_id: 'place',
      view_id: 'place_view',
      rect: { x0: 25, y0: 0, x1: 45, y1: 20 },
      hit_test_priority: 1,
      resolved_targets: () => [
        makeTarget({ module_id: 'place', view_id: 'place_view', target_type: 'place_tile', target_ref: 'place_tile', x: 8, y: 9, z: 1, priority: 1 }),
      ],
    }),
    inventory: makeConsumer({
      consumer_id: 'inventory',
      module_id: 'inventory_container',
      view_id: 'inventory_view',
      rect: { x0: 50, y0: 0, x1: 70, y1: 20 },
      hit_test_priority: 1,
      resolved_targets: () => [
        makeTarget({ module_id: 'inventory_container', view_id: 'inventory_view', target_type: 'inventory_slot', target_ref: 'inventory_slot', x: 1, y: 0, priority: 1 }),
      ],
    }),
  });

  const painterHover = registry.resolve_hover(build_interaction_pointer_state({ x: 10, y: 10 }));
  assert.equal(painterHover?.consumer_id, 'painter');
  assert.equal(painterHover?.resolved_targets.primary?.target_type, 'painter_cell');

  const placeHover = registry.resolve_hover(build_interaction_pointer_state({ x: 30, y: 10 }));
  assert.equal(placeHover?.consumer_id, 'place');
  assert.equal(placeHover?.resolved_targets.primary?.target_type, 'place_tile');

  const inventoryHover = registry.resolve_hover(build_interaction_pointer_state({ x: 60, y: 10 }));
  assert.equal(inventoryHover?.consumer_id, 'inventory');
  assert.equal(inventoryHover?.resolved_targets.primary?.target_type, 'inventory_slot');
}

function testActiveSessionRemainsSourceCapturedAcrossConsumers(): void {
  const registry = create_interaction_registry_runtime();
  const sessionLog: string[] = [];
  registry.sync_consumers({
    painter: makeConsumer({
      consumer_id: 'painter',
      module_id: 'painter_canvas',
      view_id: 'painter_view',
      rect: { x0: 0, y0: 0, x1: 20, y1: 20 },
      resolved_targets: () => [
        makeTarget({ module_id: 'painter_canvas', view_id: 'painter_view', target_type: 'painter_cell', target_ref: 'start_cell', x: 1, y: 1, priority: 0 }),
      ],
      session_log: sessionLog,
    }),
    place: makeConsumer({
      consumer_id: 'place',
      module_id: 'place',
      view_id: 'place_view',
      rect: { x0: 25, y0: 0, x1: 45, y1: 20 },
      resolved_targets: () => [
        makeTarget({ module_id: 'place', view_id: 'place_view', target_type: 'place_tile', target_ref: 'place_hover', x: 8, y: 8, z: 0, priority: 0 }),
      ],
      session_log: sessionLog,
    }),
  });

  const down = registry.process_pointer_down(build_interaction_pointer_state({ x: 5, y: 5 }), 'draw');
  assert.equal(down.session?.consumer_id, 'painter');
  assert.equal(down.session?.session.capture_owner.module_id, 'painter_canvas');

  const move = registry.process_pointer_move(build_interaction_pointer_state({ x: 30, y: 5 }));
  assert.equal(move.session?.consumer_id, 'painter');
  assert.equal(move.session?.session.capture_owner.module_id, 'painter_canvas');
  assert.equal(move.session?.session.resolved_current_target?.target_ref, 'start_cell');

  const up = registry.process_pointer_up(build_interaction_pointer_state({ x: 30, y: 5 }));
  assert.equal(up.session?.consumer_id, 'painter');
  assert.equal(up.session?.session.resolved_end_target?.target_ref, 'start_cell');
  assert.deepEqual(sessionLog, [
    'painter:begin:start_cell',
    'painter:update:start_cell',
    'painter:end:start_cell',
  ]);
}

function testResolvedTargetSelectorsPreferSessionThenHover(): void {
  const hoverTarget = makeTarget({ module_id: 'place', view_id: 'place_view', target_type: 'place_tile', target_ref: 'hover_tile', x: 1, y: 1, z: 0 });
  const sessionTarget = makeTarget({ module_id: 'inventory_container', view_id: 'inventory_view', target_type: 'inventory_slot', target_ref: 'session_slot', x: 2, y: 0 });

  const selected = select_current_resolved_target({
    session_state: {
      consumer_id: 'inventory',
      view: build_view_instance({
        module_id: 'inventory_container',
        view_id: 'inventory_view',
        space_kind: '2d',
        viewport_rect: { x0: 0, y0: 0, x1: 10, y1: 10 },
      }),
      session: {
        session_id: 'session_1',
        interaction_kind: 'drag',
        status: 'active',
        source_module_id: 'inventory_container',
        source_view_id: 'inventory_view',
        capture_owner: { module_id: 'inventory_container', view_id: 'inventory_view' },
        pointer_start: { x: 1, y: 1 },
        pointer_current: { x: 2, y: 2 },
        resolved_start_target: sessionTarget,
        resolved_current_target: sessionTarget,
        resolved_start_targets: [sessionTarget],
        resolved_current_targets: [sessionTarget],
      },
    },
    hover_state: {
      consumer_id: 'place',
      view: build_view_instance({
        module_id: 'place',
        view_id: 'place_view',
        space_kind: 'hybrid',
        viewport_rect: { x0: 0, y0: 0, x1: 10, y1: 10 },
      }),
      hover: {
        pointer: { x: 5, y: 5 },
        resolved_targets: order_resolved_targets([hoverTarget]),
      },
      resolved_targets: order_resolved_targets([hoverTarget]),
    },
  });
  assert.equal(selected?.target_ref, 'session_slot');

  const selectedPlaceTarget = select_current_resolved_target_of_type({
    session_state: null,
    hover_state: {
      consumer_id: 'place',
      view: build_view_instance({
        module_id: 'place',
        view_id: 'place_view',
        space_kind: 'hybrid',
        viewport_rect: { x0: 0, y0: 0, x1: 10, y1: 10 },
      }),
      hover: {
        pointer: { x: 5, y: 5 },
        resolved_targets: order_resolved_targets([hoverTarget]),
      },
      resolved_targets: order_resolved_targets([hoverTarget]),
    },
    target_type: 'place_tile',
    module_id: 'place',
  });
  assert.equal(selectedPlaceTarget?.target_ref, 'hover_tile');
}

function main(): void {
  console.log('Testing interaction registry runtime...');
  testHoverPrefersHighestPriorityView();
  console.log('  ok hover prefers highest priority view');
  testActiveSessionTracksResolvedTargets();
  console.log('  ok active session tracks resolved targets');
  testOrderedTargetPriority();
  console.log('  ok ordered target priority');
  testHoverSelectsAcrossConsumerFamilies();
  console.log('  ok hover selects across consumer families');
  testActiveSessionRemainsSourceCapturedAcrossConsumers();
  console.log('  ok active session remains source captured across consumers');
  testResolvedTargetSelectorsPreferSessionThenHover();
  console.log('  ok resolved target selectors prefer session then hover');
  console.log('All interaction registry runtime tests passed.');
}

main();
