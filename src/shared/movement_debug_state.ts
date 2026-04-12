export type DebugIntent = { dx: number; dy: number } | null;

type IntervalStats = {
    count: number;
    last_ms: number;
    min_ms: number;
    max_ms: number;
    sum_ms: number;
};

type RollingSamples = number[];

type InputResponsivenessTrace = {
    input_seq: number;
    kind: string | null;
    direction: DebugIntent;
    actor_ref: string | null;
    place_id: string | null;
    input_edge_ms: number;
    post_started_ms: number;
    post_ok_ms: number;
    accepted_breath: number;
    next_control_breath: number;
    breaths_per_step: number;
    move_budget_walk: number;
    move_debt_walk: number;
    tap_buffered: number;
    ms_until_next_eligible_move: number;
    gate: string | null;
    stage: string;
    visible_step_ms: number;
    visible_step_breath: number;
    input_to_visible_ms: number;
    accept_to_visible_ms: number;
};

type MovementDebugState = {
    version: string;
    input_events: number;
    input_resets: number;
    last_input_action: string | null;
    last_input_code: string | null;
    last_input_down: boolean | null;
    last_input_typing: boolean | null;
    last_input_changed_ms: number;

    current_intent: DebugIntent;
    current_intent_mode: string | null;
    current_intent_place_id: string | null;
    current_intent_actor_ref: string | null;
    last_intent_observed_ms: number;
    last_intent_changed_ms: number;
    intent_change_count: number;

    intent_posts_started: number;
    intent_posts_ok: number;
    intent_posts_failed: number;
    intent_post_change_count: number;
    intent_post_resend_count: number;
    intent_post_release_count: number;
    last_intent_post_reason: string | null;
    last_intent_post_started_ms: number;
    last_intent_post_ok_ms: number;
    last_intent_post_failed_ms: number;
    last_intent_post_status: number | null;
    last_intent_post_error: string | null;

    breath_rx: IntervalStats;
    last_breath_rx_ms: number;
    last_breath_index: number;
    last_breath_place_id: string | null;
    last_breath_bridge_latency_ms: number;
    max_breath_bridge_latency_ms: number;

    move_batch_rx: IntervalStats;
    last_move_batch_rx_ms: number;
    last_move_batch_place_id: string | null;
    last_move_batch_total_updates: number;
    last_move_batch_local_actor_updates: number;
    last_move_batch_bridge_latency_ms: number;
    max_move_batch_bridge_latency_ms: number;

    visible_step: IntervalStats;
    last_visible_step_ms: number;
    last_visible_step_breath_index: number;
    last_visible_step_place_id: string | null;
    last_visible_step_actor_ref: string | null;
    last_visible_step_seq: number | null;
    last_visible_step_position: { x: number; y: number; z: number | null } | null;

    responsiveness_trace: InputResponsivenessTrace;
    input_to_visible_samples: RollingSamples;
    accept_to_visible_samples: RollingSamples;
};

const INF_MS = 1_000_000_000;

function create_interval_stats(): IntervalStats {
    return {
        count: 0,
        last_ms: 0,
        min_ms: INF_MS,
        max_ms: 0,
        sum_ms: 0,
    };
}

function create_trace(): InputResponsivenessTrace {
    return {
        input_seq: 0,
        kind: null,
        direction: null,
        actor_ref: null,
        place_id: null,
        input_edge_ms: 0,
        post_started_ms: 0,
        post_ok_ms: 0,
        accepted_breath: 0,
        next_control_breath: 0,
        breaths_per_step: 0,
        move_budget_walk: 0,
        move_debt_walk: 0,
        tap_buffered: 0,
        ms_until_next_eligible_move: 0,
        gate: null,
        stage: 'idle',
        visible_step_ms: 0,
        visible_step_breath: 0,
        input_to_visible_ms: 0,
        accept_to_visible_ms: 0,
    };
}

function push_sample(samples: RollingSamples, value: number): void {
    samples.push(Math.max(0, Math.floor(Number(value) || 0)));
    while (samples.length > 48) samples.shift();
}

function percentile(samples: RollingSamples, p: number): number {
    if (!samples.length) return 0;
    const sorted = [...samples].sort((a, b) => a - b);
    const index = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p)));
    return sorted[index] ?? 0;
}

const movement_debug_state: MovementDebugState = {
    version: '2026-03-14-movement-debug-v1',
    input_events: 0,
    input_resets: 0,
    last_input_action: null,
    last_input_code: null,
    last_input_down: null,
    last_input_typing: null,
    last_input_changed_ms: 0,

    current_intent: null,
    current_intent_mode: null,
    current_intent_place_id: null,
    current_intent_actor_ref: null,
    last_intent_observed_ms: 0,
    last_intent_changed_ms: 0,
    intent_change_count: 0,

    intent_posts_started: 0,
    intent_posts_ok: 0,
    intent_posts_failed: 0,
    intent_post_change_count: 0,
    intent_post_resend_count: 0,
    intent_post_release_count: 0,
    last_intent_post_reason: null,
    last_intent_post_started_ms: 0,
    last_intent_post_ok_ms: 0,
    last_intent_post_failed_ms: 0,
    last_intent_post_status: null,
    last_intent_post_error: null,

    breath_rx: create_interval_stats(),
    last_breath_rx_ms: 0,
    last_breath_index: 0,
    last_breath_place_id: null,
    last_breath_bridge_latency_ms: 0,
    max_breath_bridge_latency_ms: 0,

    move_batch_rx: create_interval_stats(),
    last_move_batch_rx_ms: 0,
    last_move_batch_place_id: null,
    last_move_batch_total_updates: 0,
    last_move_batch_local_actor_updates: 0,
    last_move_batch_bridge_latency_ms: 0,
    max_move_batch_bridge_latency_ms: 0,

    visible_step: create_interval_stats(),
    last_visible_step_ms: 0,
    last_visible_step_breath_index: 0,
    last_visible_step_place_id: null,
    last_visible_step_actor_ref: null,
    last_visible_step_seq: null,
    last_visible_step_position: null,

    responsiveness_trace: create_trace(),
    input_to_visible_samples: [],
    accept_to_visible_samples: [],
};

function record_interval(stats: IntervalStats, now: number, last_at_ms: number): void {
    if (last_at_ms <= 0) return;
    const dt = Math.max(0, now - last_at_ms);
    stats.count += 1;
    stats.last_ms = dt;
    stats.min_ms = Math.min(stats.min_ms, dt);
    stats.max_ms = Math.max(stats.max_ms, dt);
    stats.sum_ms += dt;
}

function intent_key(intent: DebugIntent): string {
    if (!intent) return 'none';
    return `${intent.dx},${intent.dy}`;
}

export function record_input_transition(action: string, code: string, down: boolean, typing: boolean): void {
    movement_debug_state.input_events += 1;
    movement_debug_state.last_input_action = action;
    movement_debug_state.last_input_code = code;
    movement_debug_state.last_input_down = down;
    movement_debug_state.last_input_typing = typing;
    movement_debug_state.last_input_changed_ms = Date.now();
}

export function record_input_reset(): void {
    movement_debug_state.input_resets += 1;
    movement_debug_state.last_input_action = 'reset_all';
    movement_debug_state.last_input_code = null;
    movement_debug_state.last_input_down = false;
    movement_debug_state.last_input_typing = false;
    movement_debug_state.last_input_changed_ms = Date.now();
}

export function record_intent_observed(intent: DebugIntent, meta?: { mode?: string | null; place_id?: string | null; actor_ref?: string | null }): void {
    const now = Date.now();
    const prev_key = intent_key(movement_debug_state.current_intent);
    const next_key = intent_key(intent);
    if (prev_key !== next_key) {
        movement_debug_state.last_intent_changed_ms = now;
        movement_debug_state.intent_change_count += 1;
    }
    movement_debug_state.current_intent = intent ? { dx: intent.dx, dy: intent.dy } : null;
    movement_debug_state.current_intent_mode = meta?.mode ?? movement_debug_state.current_intent_mode;
    movement_debug_state.current_intent_place_id = meta?.place_id ?? movement_debug_state.current_intent_place_id;
    movement_debug_state.current_intent_actor_ref = meta?.actor_ref ?? movement_debug_state.current_intent_actor_ref;
    movement_debug_state.last_intent_observed_ms = now;
}

export function record_intent_post_started(meta: {
    reason: 'change' | 'resend' | 'release';
    kind?: string;
    input_seq?: number;
    actor_ref: string;
    place_id: string;
    mode: string;
    dx: number;
    dy: number;
}): void {
    movement_debug_state.intent_posts_started += 1;
    movement_debug_state.last_intent_post_reason = meta.reason;
    movement_debug_state.last_intent_post_started_ms = Date.now();
    movement_debug_state.current_intent_actor_ref = meta.actor_ref;
    movement_debug_state.current_intent_place_id = meta.place_id;
    movement_debug_state.current_intent_mode = meta.mode;
    movement_debug_state.current_intent = (meta.dx === 0 && meta.dy === 0) ? null : { dx: meta.dx, dy: meta.dy };
    movement_debug_state.responsiveness_trace.input_seq = Math.max(0, Math.floor(Number(meta.input_seq ?? 0)) || 0);
    movement_debug_state.responsiveness_trace.kind = meta.kind ?? null;
    movement_debug_state.responsiveness_trace.direction = movement_debug_state.current_intent ? { ...movement_debug_state.current_intent } : null;
    movement_debug_state.responsiveness_trace.actor_ref = meta.actor_ref;
    movement_debug_state.responsiveness_trace.place_id = meta.place_id;
    movement_debug_state.responsiveness_trace.input_edge_ms = Math.max(0, movement_debug_state.last_input_changed_ms);
    movement_debug_state.responsiveness_trace.post_started_ms = movement_debug_state.last_intent_post_started_ms;
    movement_debug_state.responsiveness_trace.stage = 'posted';
    if (meta.reason === 'change') movement_debug_state.intent_post_change_count += 1;
    if (meta.reason === 'resend') movement_debug_state.intent_post_resend_count += 1;
    if (meta.reason === 'release') movement_debug_state.intent_post_release_count += 1;
}

export function record_intent_post_result(ok: boolean, meta?: { status?: number | null; error?: string | null }): void {
    const now = Date.now();
    if (ok) {
        movement_debug_state.intent_posts_ok += 1;
        movement_debug_state.last_intent_post_ok_ms = now;
        movement_debug_state.last_intent_post_status = meta?.status ?? 200;
        movement_debug_state.last_intent_post_error = null;
        movement_debug_state.responsiveness_trace.post_ok_ms = now;
        return;
    }
    movement_debug_state.intent_posts_failed += 1;
    movement_debug_state.last_intent_post_failed_ms = now;
    movement_debug_state.last_intent_post_status = meta?.status ?? null;
    movement_debug_state.last_intent_post_error = meta?.error ?? 'unknown';
}

export function record_intent_server_accept(meta: {
    input_seq: number;
    kind: string;
    actor_ref: string;
    place_id: string;
    direction: DebugIntent;
    accepted_breath: number;
    next_control_breath: number;
    breaths_per_step: number;
    move_budget_walk: number;
    move_debt_walk: number;
    tap_buffered: number;
    ms_until_next_eligible_move: number;
    gate: string | null;
}): void {
    movement_debug_state.responsiveness_trace.input_seq = Math.max(0, Math.floor(meta.input_seq));
    movement_debug_state.responsiveness_trace.kind = meta.kind;
    movement_debug_state.responsiveness_trace.actor_ref = meta.actor_ref;
    movement_debug_state.responsiveness_trace.place_id = meta.place_id;
    movement_debug_state.responsiveness_trace.direction = meta.direction ? { dx: meta.direction.dx, dy: meta.direction.dy } : null;
    movement_debug_state.responsiveness_trace.accepted_breath = Math.max(0, Math.floor(meta.accepted_breath));
    movement_debug_state.responsiveness_trace.next_control_breath = Math.max(0, Math.floor(meta.next_control_breath));
    movement_debug_state.responsiveness_trace.breaths_per_step = Math.max(0, Math.floor(meta.breaths_per_step));
    movement_debug_state.responsiveness_trace.move_budget_walk = Number(meta.move_budget_walk) || 0;
    movement_debug_state.responsiveness_trace.move_debt_walk = Math.max(0, Math.floor(Number(meta.move_debt_walk) || 0));
    movement_debug_state.responsiveness_trace.tap_buffered = Math.max(0, Math.floor(meta.tap_buffered));
    movement_debug_state.responsiveness_trace.ms_until_next_eligible_move = Math.max(0, Math.floor(meta.ms_until_next_eligible_move));
    movement_debug_state.responsiveness_trace.gate = meta.gate ?? null;
    movement_debug_state.responsiveness_trace.stage = meta.gate && meta.gate !== 'ok'
        ? meta.gate
        : (movement_debug_state.responsiveness_trace.ms_until_next_eligible_move > 0 ? 'waiting_for_cadence' : 'eligible_now');
}

export function record_place_breath_tick(meta: { place_id: string; breath_index: number; sent_at_ms?: number | null }): void {
    const now = Date.now();
    record_interval(movement_debug_state.breath_rx, now, movement_debug_state.last_breath_rx_ms);
    movement_debug_state.last_breath_rx_ms = now;
    movement_debug_state.last_breath_place_id = meta.place_id;
    movement_debug_state.last_breath_index = Math.max(0, Math.floor(meta.breath_index));
    const latency = Number(meta.sent_at_ms);
    if (Number.isFinite(latency) && latency > 0) {
        movement_debug_state.last_breath_bridge_latency_ms = Math.max(0, now - latency);
        movement_debug_state.max_breath_bridge_latency_ms = Math.max(
            movement_debug_state.max_breath_bridge_latency_ms,
            movement_debug_state.last_breath_bridge_latency_ms,
        );
    }
}

export function record_move_batch_received(meta: {
    place_id: string;
    total_updates: number;
    local_actor_updates: number;
    sent_at_ms?: number | null;
}): void {
    const now = Date.now();
    record_interval(movement_debug_state.move_batch_rx, now, movement_debug_state.last_move_batch_rx_ms);
    movement_debug_state.last_move_batch_rx_ms = now;
    movement_debug_state.last_move_batch_place_id = meta.place_id;
    movement_debug_state.last_move_batch_total_updates = Math.max(0, Math.floor(meta.total_updates));
    movement_debug_state.last_move_batch_local_actor_updates = Math.max(0, Math.floor(meta.local_actor_updates));
    const latency = Number(meta.sent_at_ms);
    if (Number.isFinite(latency) && latency > 0) {
        movement_debug_state.last_move_batch_bridge_latency_ms = Math.max(0, now - latency);
        movement_debug_state.max_move_batch_bridge_latency_ms = Math.max(
            movement_debug_state.max_move_batch_bridge_latency_ms,
            movement_debug_state.last_move_batch_bridge_latency_ms,
        );
    }
}

export function record_local_actor_step_applied(meta: {
    actor_ref: string;
    place_id: string;
    breath_index: number;
    x: number;
    y: number;
    z?: number | null;
    seq?: number | null;
}): void {
    const now = Date.now();
    record_interval(movement_debug_state.visible_step, now, movement_debug_state.last_visible_step_ms);
    movement_debug_state.last_visible_step_ms = now;
    movement_debug_state.last_visible_step_actor_ref = meta.actor_ref;
    movement_debug_state.last_visible_step_place_id = meta.place_id;
    movement_debug_state.last_visible_step_breath_index = Math.max(0, Math.floor(meta.breath_index));
    movement_debug_state.last_visible_step_seq = (typeof meta.seq === 'number' && Number.isFinite(meta.seq)) ? Math.floor(meta.seq) : null;
    movement_debug_state.last_visible_step_position = {
        x: Math.floor(meta.x),
        y: Math.floor(meta.y),
        z: (typeof meta.z === 'number' && Number.isFinite(meta.z)) ? Math.floor(meta.z) : null,
    };
    movement_debug_state.responsiveness_trace.visible_step_ms = now;
    movement_debug_state.responsiveness_trace.visible_step_breath = Math.max(0, Math.floor(meta.breath_index));
    movement_debug_state.responsiveness_trace.stage = 'moved';
    if (movement_debug_state.responsiveness_trace.input_edge_ms > 0) {
        movement_debug_state.responsiveness_trace.input_to_visible_ms = Math.max(0, now - movement_debug_state.responsiveness_trace.input_edge_ms);
        push_sample(movement_debug_state.input_to_visible_samples, movement_debug_state.responsiveness_trace.input_to_visible_ms);
    }
    if (movement_debug_state.responsiveness_trace.post_ok_ms > 0) {
        movement_debug_state.responsiveness_trace.accept_to_visible_ms = Math.max(0, now - movement_debug_state.responsiveness_trace.post_ok_ms);
        push_sample(movement_debug_state.accept_to_visible_samples, movement_debug_state.responsiveness_trace.accept_to_visible_ms);
    }
}

export function get_movement_debug_snapshot() {
    return {
        ...movement_debug_state,
        current_intent: movement_debug_state.current_intent ? { ...movement_debug_state.current_intent } : null,
        breath_rx: { ...movement_debug_state.breath_rx },
        move_batch_rx: { ...movement_debug_state.move_batch_rx },
        visible_step: { ...movement_debug_state.visible_step },
        responsiveness_trace: {
            ...movement_debug_state.responsiveness_trace,
            direction: movement_debug_state.responsiveness_trace.direction ? { ...movement_debug_state.responsiveness_trace.direction } : null,
        },
        input_to_visible_samples: [...movement_debug_state.input_to_visible_samples],
        accept_to_visible_samples: [...movement_debug_state.accept_to_visible_samples],
        last_visible_step_position: movement_debug_state.last_visible_step_position
            ? { ...movement_debug_state.last_visible_step_position }
            : null,
    };
}

export function format_interval_avg(stats: IntervalStats): number {
    return stats.count > 0 ? Math.round(stats.sum_ms / stats.count) : 0;
}

export function format_interval_min(stats: IntervalStats): number {
    return stats.count > 0 ? stats.min_ms : 0;
}

export function format_sample_p50(samples: RollingSamples): number {
    return percentile(samples, 0.5);
}

export function format_sample_p95(samples: RollingSamples): number {
    return percentile(samples, 0.95);
}
