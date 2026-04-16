import { app, BrowserWindow, ipcMain, clipboard, dialog } from 'electron';
import {
    readFileSync,
    writeFileSync,
    existsSync,
    mkdirSync,
    openSync,
    writeSync,
    fsyncSync,
    closeSync,
    renameSync,
    unlinkSync,
} from 'fs';
import { join, dirname, basename } from 'path';

const DEFAULT_INPUT_BINDINGS = {
    KeyW: 'move_up',
    KeyS: 'move_down',
    KeyA: 'move_left',
    KeyD: 'move_right',
    Space: 'jump',
    Escape: 'cancel',
};

const GAMEPLAY_INPUT_TRACE_ENABLED = true;
const RAW_GAMEPLAY_HOST_TRACE_ENABLED = false;
const RAW_GAMEPLAY_TRACE_CODES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'Escape']);
const GAMEPLAY_INPUT_EVENT_SOURCE = 'renderer_dom_bridge';

function log_input_trace(message, payload = {}) {
    if (!GAMEPLAY_INPUT_TRACE_ENABLED) return;
    try {
        console.log(`[INPUT_TRACE] ${message} ${JSON.stringify(payload)}`);
    } catch {
        // ignore
    }
}

function log_raw_gameplay_host_event(win, input) {
    if (!RAW_GAMEPLAY_HOST_TRACE_ENABLED) return;
    const code = normalize_input_code(input);
    if (!RAW_GAMEPLAY_TRACE_CODES.has(code)) return;
    if (Boolean(input.isAutoRepeat)) return;
    log_input_trace('raw host event', {
        web_contents_id: win?.webContents?.id ?? null,
        type: input.type,
        code,
        key: input.key,
        repeat: Boolean(input.isAutoRepeat),
        is_composing: Boolean(input.isComposing),
        control: Boolean(input.control),
        shift: Boolean(input.shift),
        alt: Boolean(input.alt),
        meta: Boolean(input.meta),
    });
}

function create_action_states() {
    return {
        move_up: { down: false, down_seq: 0 },
        move_down: { down: false, down_seq: 0 },
        move_left: { down: false, down_seq: 0 },
        move_right: { down: false, down_seq: 0 },
        jump: { down: false, down_seq: 0 },
        cancel: { down: false, down_seq: 0 },
    };
}

function clone_action_states(states) {
    return {
        move_up: { ...states.move_up },
        move_down: { ...states.move_down },
        move_left: { ...states.move_left },
        move_right: { ...states.move_right },
        jump: { ...states.jump },
        cancel: { ...states.cancel },
    };
}

function is_directional_action(action) {
    return action === 'move_up' || action === 'move_down' || action === 'move_left' || action === 'move_right';
}

function move_intent_key(intent) {
    if (!intent) return 'none';
    return `${intent.dx},${intent.dy}`;
}

function create_gameplay_input_state() {
    return {
        bindings: { ...DEFAULT_INPUT_BINDINGS },
        actions: create_action_states(),
        keyStates: new Map(),
        globalSeq: 0,
        globalInputSeq: 0,
        revision: 0,
        currentMoveAction: null,
        lastEmittedIntentKey: 'none',
        context: {
            typing: false,
            window_focused: true,
            active_element_id: null,
            focused_owner_id: null,
            player_id: 'player_1',
            channel_id: 'electron_main_keyboard',
            device_id: 'electron_before_input_event',
            session_token: null,
            actor_ref: null,
            place_id: null,
            move_mode: 'WALK',
            principal_view: 'top',
            roll_quarter_turn: 0,
        },
        lastSentGameplayIntentKey: 'none',
        lastMovementInputSeq: 0,
        lastContextTraceKey: '',
    };
}

const gameplay_inputs = new Map();

function get_gameplay_input_state(webContentsId) {
    let state = gameplay_inputs.get(webContentsId);
    if (state) return state;
    state = create_gameplay_input_state();
    gameplay_inputs.set(webContentsId, state);
    return state;
}

function get_move_intent(state) {
    const actions = state.actions;
    let winner = state.currentMoveAction;
    if (!is_directional_action(winner) || !actions[winner]?.down) {
        winner = pick_fallback_move_action(state, winner);
        state.currentMoveAction = winner;
    }
    switch (winner) {
        case 'move_up': return { dx: 0, dy: 1 };
        case 'move_down': return { dx: 0, dy: -1 };
        case 'move_left': return { dx: -1, dy: 0 };
        case 'move_right': return { dx: 1, dy: 0 };
        default: return null;
    }
}

function pick_fallback_move_action(state, excluding) {
    let winner = null;
    let winnerSeq = -1;
    for (const action of ['move_up', 'move_down', 'move_left', 'move_right']) {
        if (action === excluding) continue;
        const current = state.actions[action];
        if (!current?.down) continue;
        if (current.down_seq > winnerSeq) {
            winner = action;
            winnerSeq = current.down_seq;
        }
    }
    return winner;
}

function get_snapshot(state) {
    return {
        player_id: state.context.player_id || 'player_1',
        actions: clone_action_states(state.actions),
        move_intent: get_move_intent(state),
        revision: state.revision,
    };
}

function normalize_place_principal_view(value) {
    switch (String(value ?? '').trim().toLowerCase()) {
        case 'bottom':
        case 'north':
        case 'east':
        case 'south':
        case 'west':
            return String(value).trim().toLowerCase();
        case 'top':
        default:
            return 'top';
    }
}

function normalize_place_view_roll_quarter_turn(value) {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n)) return 0;
    const normalized = ((n % 4) + 4) % 4;
    return normalized;
}

function get_view_basis(state) {
    const principal = normalize_place_principal_view(state.principal_view);
    const roll = normalize_place_view_roll_quarter_turn(state.roll_quarter_turn);
    const base = {
        top: { forward: { x: 0, y: 0, z: 1 }, up: { x: 0, y: -1, z: 0 }, right: { x: 1, y: 0, z: 0 } },
        bottom: { forward: { x: 0, y: 0, z: -1 }, up: { x: 0, y: 1, z: 0 }, right: { x: 1, y: 0, z: 0 } },
        north: { forward: { x: 0, y: 1, z: 0 }, up: { x: 0, y: 0, z: 1 }, right: { x: 1, y: 0, z: 0 } },
        east: { forward: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 }, right: { x: 0, y: -1, z: 0 } },
        south: { forward: { x: 0, y: -1, z: 0 }, up: { x: 0, y: 0, z: 1 }, right: { x: -1, y: 0, z: 0 } },
        west: { forward: { x: -1, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 }, right: { x: 0, y: 1, z: 0 } },
    }[principal];
    let up = base.up;
    let right = base.right;
    switch (roll) {
        case 1:
            up = right;
            right = { x: -base.up.x, y: -base.up.y, z: -base.up.z };
            break;
        case 2:
            up = { x: -base.up.x, y: -base.up.y, z: -base.up.z };
            right = { x: -base.right.x, y: -base.right.y, z: -base.right.z };
            break;
        case 3:
            up = { x: -base.right.x, y: -base.right.y, z: -base.right.z };
            right = base.up;
            break;
    }
    return { forward: base.forward, up, right };
}

function project_axis_to_ground(axis) {
    const absX = Math.abs(axis.x);
    const absY = Math.abs(axis.y);
    if (absX < 1 && absY < 1) return null;
    if (absX >= absY) return { dx: axis.x > 0 ? 1 : -1, dy: 0 };
    return { dx: 0, dy: axis.y > 0 ? 1 : -1 };
}

function negate_ground_delta(delta) {
    if (!delta) return null;
    return { dx: -delta.dx, dy: -delta.dy };
}

function map_screen_direction_to_ground_delta(state, direction) {
    const basis = get_view_basis(state);
    const horizontal = project_axis_to_ground(basis.right) ?? project_axis_to_ground(basis.forward) ?? { dx: 1, dy: 0 };
    const vertical = project_axis_to_ground(basis.up) ?? project_axis_to_ground(basis.forward) ?? { dx: 0, dy: -1 };
    switch (direction) {
        case 'left': return negate_ground_delta(horizontal) ?? { dx: -1, dy: 0 };
        case 'right': return horizontal;
        case 'down': return vertical;
        case 'up':
        default: return negate_ground_delta(vertical) ?? { dx: 0, dy: -1 };
    }
}

function map_screen_move_intent_to_ground_delta(viewState, intent) {
    if (!intent) return null;
    const out = { dx: 0, dy: 0 };
    if (intent.dx < 0) {
        const delta = map_screen_direction_to_ground_delta(viewState, 'left');
        out.dx += delta.dx;
        out.dy += delta.dy;
    } else if (intent.dx > 0) {
        const delta = map_screen_direction_to_ground_delta(viewState, 'right');
        out.dx += delta.dx;
        out.dy += delta.dy;
    }
    if (intent.dy < 0) {
        const delta = map_screen_direction_to_ground_delta(viewState, 'down');
        out.dx += delta.dx;
        out.dy += delta.dy;
    } else if (intent.dy > 0) {
        const delta = map_screen_direction_to_ground_delta(viewState, 'up');
        out.dx += delta.dx;
        out.dy += delta.dy;
    }
    const dx = Math.max(-1, Math.min(1, out.dx));
    const dy = Math.max(-1, Math.min(1, out.dy));
    if (dx === 0 && dy === 0) return null;
    return { dx, dy };
}

async function dispatch_gameplay_movement_intent(state, intent) {
    const actorRef = typeof state.context.actor_ref === 'string' ? state.context.actor_ref : '';
    const placeId = typeof state.context.place_id === 'string' ? state.context.place_id : '';
    if (!actorRef || !placeId) {
        log_input_trace('movement skipped missing context', {
            actor_ref: actorRef || null,
            place_id: placeId || null,
            session_token: state.context.session_token ? 'present' : 'missing',
            move_mode: state.context.move_mode,
        });
        return;
    }
    const mapped = map_screen_move_intent_to_ground_delta({
        principal_view: state.context.principal_view,
        roll_quarter_turn: state.context.roll_quarter_turn,
    }, intent);
    const previousKey = state.lastSentGameplayIntentKey;
    const nextKey = move_intent_key(mapped);
    if (nextKey === previousKey) return;
    state.lastSentGameplayIntentKey = nextKey;
    state.lastMovementInputSeq += 1;
    const kind = !mapped ? 'release' : previousKey === 'none' ? 'press' : 'replace';
    const reason = mapped ? 'change' : 'release';
    const movementRequest = {
        actor_ref: actorRef,
        place_id: placeId,
        mode: state.context.move_mode ?? 'WALK',
        kind,
        reason,
        input_seq: state.lastMovementInputSeq,
        dx: mapped?.dx ?? 0,
        dy: mapped?.dy ?? 0,
    };
    log_input_trace('movement dispatch', {
        input_seq: movementRequest.input_seq,
        actor_ref: movementRequest.actor_ref,
        place_id: movementRequest.place_id,
        screen_intent: intent,
        mapped_intent: mapped,
        kind: movementRequest.kind,
        reason: movementRequest.reason,
        move_mode: movementRequest.mode,
        principal_view: state.context.principal_view,
        roll_quarter_turn: state.context.roll_quarter_turn,
    });
    send_gameplay_input_message(state.win, {
        type: 'movement_post_started',
        ...movementRequest,
    });
    try {
        const response = await fetch('http://127.0.0.1:8787/api/movement/intent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_token: state.context.session_token ?? undefined,
                entity_ref: movementRequest.actor_ref,
                place_id: movementRequest.place_id,
                dx: movementRequest.dx,
                dy: movementRequest.dy,
                mode: movementRequest.mode,
                kind: movementRequest.kind,
                input_seq: movementRequest.input_seq,
                reason: movementRequest.reason,
            }),
        });
        const data = await response.json().catch(() => null);
        log_input_trace('movement response', {
            input_seq: movementRequest.input_seq,
            status: response.status,
            ok: response.ok,
            accepted_breath: Number(data?.accepted_breath ?? 0) || 0,
            next_control_breath: Number(data?.next_control_breath ?? 0) || 0,
            gate: typeof data?.gate === 'string' ? data.gate : null,
            ignored: Boolean(data?.ignored),
        });
        send_gameplay_input_message(state.win, {
            type: 'movement_post_result',
            ok: Boolean(response.ok && data?.ok !== false),
            status: Number(response.status) || null,
            error: data?.error ?? (response.ok ? null : `HTTP ${response.status}`),
            actor_ref: movementRequest.actor_ref,
            place_id: movementRequest.place_id,
            input_seq: movementRequest.input_seq,
            kind: String(data?.kind ?? movementRequest.kind),
            dx: Number(data?.dx ?? movementRequest.dx) || 0,
            dy: Number(data?.dy ?? movementRequest.dy) || 0,
            accepted_breath: Number(data?.accepted_breath ?? 0) || 0,
            next_control_breath: Number(data?.next_control_breath ?? 0) || 0,
            breaths_per_step: Number(data?.breaths_per_step ?? 0) || 0,
            move_budget_walk: Number(data?.move_budget_walk ?? 0) || 0,
            move_debt_walk: Number(data?.move_debt_walk ?? 0) || 0,
            tap_buffered: Number(data?.tap_buffered ?? 0) || 0,
            ms_until_next_eligible_move: Number(data?.ms_until_next_eligible_move ?? 0) || 0,
            gate: typeof data?.gate === 'string' ? data.gate : null,
        });
    } catch (error) {
        log_input_trace('movement post failed', {
            input_seq: movementRequest.input_seq,
            error: error?.message ?? String(error),
        });
        send_gameplay_input_message(state.win, {
            type: 'movement_post_result',
            ok: false,
            status: null,
            error: error?.message ?? String(error),
            actor_ref: movementRequest.actor_ref,
            place_id: movementRequest.place_id,
            input_seq: movementRequest.input_seq,
            kind: movementRequest.kind,
            dx: movementRequest.dx,
            dy: movementRequest.dy,
            gate: null,
        });
    }
}

async function dispatch_gameplay_jump(state) {
    const actorRef = typeof state.context.actor_ref === 'string' ? state.context.actor_ref : '';
    if (!actorRef) {
        log_input_trace('jump skipped missing actor', {
            actor_ref: actorRef || null,
            place_id: state.context.place_id || null,
        });
        return;
    }
    const actorId = String(actorRef).replace(/^actor\./, '');
    log_input_trace('jump dispatch', {
        actor_ref: actorRef,
        place_id: state.context.place_id || null,
        path: 'electron_main_jump',
    });
    try {
        const response = await fetch('http://127.0.0.1:8787/api/actor/debug/ascend', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ actor_id: actorId, vz_delta: 3 }),
        });
        const data = await response.json().catch(() => null);
        log_input_trace('jump response', {
            actor_ref: actorRef,
            status: response.status,
            ok: response.ok && Boolean(data?.ok),
            velocity: data?.velocity ?? null,
            error: data?.error ?? null,
        });
    } catch (error) {
        log_input_trace('jump post failed', {
            actor_ref: actorRef,
            error: error?.message ?? String(error),
        });
    }
}

function send_gameplay_input_message(win, message) {
    if (!win || win.isDestroyed()) return;
    win.webContents.send('gameplay-input-message', message);
}

function emit_snapshot(win, state) {
    send_gameplay_input_message(win, {
        type: 'snapshot',
        snapshot: get_snapshot(state),
    });
}

function emit_move_intent_if_changed(win, state, meta, force = false) {
    const intent = get_move_intent(state);
    const nextKey = move_intent_key(intent);
    if (!force && nextKey === state.lastEmittedIntentKey) return;
    state.lastEmittedIntentKey = nextKey;
    send_gameplay_input_message(win, {
        type: 'move_intent_changed',
        player_id: meta.player_id,
        intent,
        meta,
    });
    state.win = win;
    void dispatch_gameplay_movement_intent(state, intent);
}

function normalize_input_code(input) {
    if (typeof input.code === 'string' && input.code.length > 0) return input.code;
    const key = String(input.key || '');
    if (key.length === 1 && key >= 'a' && key <= 'z') return `Key${key.toUpperCase()}`;
    if (key.length === 1 && key >= 'A' && key <= 'Z') return `Key${key}`;
    if (key === ' ') return 'Space';
    return key;
}

function ingest_gameplay_keydown(win, state, input) {
    const code = normalize_input_code(input);
    const action = state.bindings[code] ?? null;
    if (!action) return;
    if (state.context.typing && action !== 'cancel') {
        log_input_trace('keydown suppressed by typing gate', { code, key: input.key, action });
        return;
    }

    const keyState = state.keyStates.get(code) ?? { down: false };
    if (keyState.down) {
        if (is_directional_action(action)) state.currentMoveAction = action;
        state.keyStates.set(code, keyState);
        return;
    }
    keyState.down = true;
    state.keyStates.set(code, keyState);

    const current = state.actions[action];
    if (current.down) {
        if (is_directional_action(action)) state.currentMoveAction = action;
        return;
    }

    state.globalSeq += 1;
    state.globalInputSeq += 1;
    current.down = true;
    current.down_seq = state.globalSeq;
    state.revision += 1;
    if (is_directional_action(action)) state.currentMoveAction = action;
    log_input_trace('keydown accepted', {
        code,
        key: input.key,
        action,
        repeat: Boolean(input.isAutoRepeat),
        actor_ref: state.context.actor_ref || null,
        place_id: state.context.place_id || null,
        typing: state.context.typing,
    });

    emit_move_intent_if_changed(win, state, {
        source: 'keydown',
        kind: 'press',
        action,
        code,
        input_seq: state.globalInputSeq,
        player_id: state.context.player_id || 'player_1',
    });
    if (action === 'jump') {
        void dispatch_gameplay_jump(state);
    }
    emit_snapshot(win, state);
}

function ingest_gameplay_keyup(win, state, input) {
    const code = normalize_input_code(input);
    const action = state.bindings[code] ?? null;
    if (!action) return;
    log_input_trace('keyup accepted', {
        code,
        key: input.key,
        action,
        actor_ref: state.context.actor_ref || null,
        place_id: state.context.place_id || null,
    });
    const keyState = state.keyStates.get(code);
    if (keyState) keyState.down = false;
    const current = state.actions[action];
    if (!current?.down) return;

    state.globalInputSeq += 1;
    current.down = false;
    state.revision += 1;
    if (state.currentMoveAction === action) {
        state.currentMoveAction = pick_fallback_move_action(state, action);
    }

    emit_move_intent_if_changed(win, state, {
        source: 'keyup',
        kind: get_move_intent(state) ? 'replace' : 'release',
        action,
        code,
        input_seq: state.globalInputSeq,
        player_id: state.context.player_id || 'player_1',
    });
    emit_snapshot(win, state);
}

function reset_gameplay_input(win, state, reason = 'reset') {
    for (const action of Object.keys(state.actions)) {
        state.actions[action].down = false;
        state.actions[action].down_seq = 0;
    }
    state.keyStates.clear();
    state.currentMoveAction = null;
    state.globalInputSeq += 1;
    state.revision += 1;
    state.lastEmittedIntentKey = 'none';
    state.lastSentGameplayIntentKey = 'none';
    emit_move_intent_if_changed(win, state, {
        source: 'reset',
        kind: 'release',
        action: null,
        code: reason,
        input_seq: state.globalInputSeq,
        player_id: state.context.player_id || 'player_1',
    }, true);
    emit_snapshot(win, state);
}

function route_gameplay_keyboard_message(win, state, message, source) {
    const type = message.type === 'keyup' ? 'keyup' : 'keydown';
    const input = {
        type: type === 'keydown' ? 'keyDown' : 'keyUp',
        code: typeof message.code === 'string' ? message.code : '',
        key: typeof message.key === 'string' ? message.key : '',
        isAutoRepeat: Boolean(message.repeat),
    };
    log_input_trace('renderer bridge event', {
        source,
        web_contents_id: win?.webContents?.id ?? null,
        type: input.type,
        code: input.code,
        key: input.key,
        repeat: input.isAutoRepeat,
    });
    const action = state.bindings[input.code] ?? null;
    const context_ready = Boolean(state.context.session_token && state.context.actor_ref && state.context.place_id);
    if ((action === 'jump' || is_directional_action(action)) && !context_ready) {
        log_input_trace('renderer bridge skipped pending context', {
            source,
            type: input.type,
            code: input.code,
            action,
            actor_ref: state.context.actor_ref || null,
            place_id: state.context.place_id || null,
            session_token: state.context.session_token ? 'present' : 'missing',
        });
        return;
    }
    if (input.type === 'keyDown') {
        ingest_gameplay_keydown(win, state, input);
    } else {
        ingest_gameplay_keyup(win, state, input);
    }
}

function attach_gameplay_input_bridge(win) {
    const state = get_gameplay_input_state(win.webContents.id);
    win.webContents.on('before-input-event', (_event, input) => {
        log_raw_gameplay_host_event(win, input);
        if (GAMEPLAY_INPUT_EVENT_SOURCE !== 'electron_before_input_event') {
            return;
        }
        if (input.type === 'keyDown') {
            ingest_gameplay_keydown(win, state, input);
        } else if (input.type === 'keyUp') {
            ingest_gameplay_keyup(win, state, input);
        }
    });
    win.on('blur', () => {
        state.context.window_focused = false;
        reset_gameplay_input(win, state, 'window_blur');
    });
    win.on('focus', () => {
        state.context.window_focused = true;
    });
}

// Determine which mode we're in
const IS_PAINTER_MODE = process.env.THAUM_APP_MODE === 'ascii_painter';

// Use different ports for game vs painter so they can run simultaneously
const DEV_URL = IS_PAINTER_MODE 
    ? 'http://localhost:5174'  // Painter port
    : 'http://localhost:5173'; // Game port

function create_window() {
    console.log('[Electron] Creating window...');
    console.log(`[Electron] Mode: ${IS_PAINTER_MODE ? 'ASCII Painter' : 'Game'}`);
    console.log(`[Electron] Loading URL: ${DEV_URL}`);
    
    const win = new BrowserWindow({
        width: 1400,
        height: 900,
        autoHideMenuBar: true,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            preload: join(process.cwd(), 'electron', 'preload.js'),
        },
    });

    attach_gameplay_input_bridge(win);

    // Mode is set via preload script before page loads
    // Preload reads process.env.THAUM_APP_MODE and exposes it as window.electronAPI.appMode

    // Add error handlers
    win.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        console.error('[Electron] Failed to load:', errorCode, errorDescription);
    });

    win.webContents.on('crashed', (event, killed) => {
        console.error('[Electron] Renderer crashed:', killed);
    });

    win.webContents.on('console-message', (event, level, message, line, sourceId) => {
        const levelName = ['debug', 'log', 'warn', 'error'][level] || 'log';
        console.log(`[Renderer ${levelName}] ${message}`);
    });

    win.loadURL(DEV_URL).catch(err => {
        console.error('[Electron] Failed to load URL:', err);
    });
    
    console.log('[Electron] Window created successfully');
}

function get_ascii_drawings_dir() {
    const dir = join(process.cwd(), 'ascii_drawings');
    try {
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    } catch {
        // ignore
    }
    return dir;
}

function write_file_atomic(targetPath, content) {
    const dir = dirname(targetPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const base = basename(targetPath);
    const tmpPath = join(dir, `.${base}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const bakPath = join(dir, `.${base}.bak`);

    const fd = openSync(tmpPath, 'w');
    try {
        writeSync(fd, content, 0, 'utf-8');
        fsyncSync(fd);
    } finally {
        closeSync(fd);
    }

    // Swap in atomically as best-effort on Windows (rename won't overwrite).
    try {
        if (existsSync(bakPath)) {
            try { unlinkSync(bakPath); } catch { /* ignore */ }
        }

        if (existsSync(targetPath)) {
            renameSync(targetPath, bakPath);
        }
        renameSync(tmpPath, targetPath);
        if (existsSync(bakPath)) {
            try { unlinkSync(bakPath); } catch { /* ignore */ }
        }
    } catch (e) {
        // Attempt to restore from backup if the swap failed
        try {
            if (existsSync(bakPath) && !existsSync(targetPath)) {
                renameSync(bakPath, targetPath);
            }
        } catch {
            // ignore
        }

        try { if (existsSync(tmpPath)) unlinkSync(tmpPath); } catch { /* ignore */ }
        throw e;
    }
}

// IPC handlers for renderer communication
ipcMain.handle('read-file', async (event, filePath) => {
    try {
        const content = readFileSync(filePath, 'utf-8');
        return { success: true, content };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('write-file', async (event, filePath, content) => {
    try {
        writeFileSync(filePath, content, 'utf-8');
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('write-file-atomic', async (event, filePath, content) => {
    try {
        write_file_atomic(filePath, content);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('get-ascii-drawings-dir', async () => {
    return get_ascii_drawings_dir();
});

ipcMain.handle('show-open-dialog', async (event, options) => {
    try {
        const win = BrowserWindow.fromWebContents(event.sender);
        const result = await dialog.showOpenDialog(win, options);
        return { success: true, result };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('get-data-slot-dir', async (event, slot) => {
    return join(process.cwd(), 'local_data', `data_slot_${slot}`);
});

// Clipboard IPC handlers
ipcMain.handle('clipboard-read-text', async () => {
    try {
        const text = clipboard.readText();
        return { success: true, text };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('clipboard-write-text', async (event, text) => {
    try {
        clipboard.writeText(text);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('clipboard-read-image', async () => {
    try {
        const image = clipboard.readImage();
        if (image.isEmpty()) {
            return { success: false, error: 'No image in clipboard' };
        }
        // Convert to data URL for transfer to renderer
        const dataUrl = image.toDataURL();
        return { success: true, dataUrl, width: image.getSize().width, height: image.getSize().height };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('clipboard-has-image', async () => {
    try {
        const hasImage = clipboard.hasImage && clipboard.hasImage();
        return { success: true, hasImage };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.on('gameplay-input-context', (event, payload) => {
    const state = get_gameplay_input_state(event.sender.id);
    const next = payload && typeof payload === 'object' ? payload : {};
    const has = (key) => Object.prototype.hasOwnProperty.call(next, key);
    state.context = {
        ...state.context,
        typing: has('typing') ? Boolean(next.typing) : state.context.typing,
        window_focused: has('window_focused') ? Boolean(next.window_focused) : state.context.window_focused,
        active_element_id: has('active_element_id') ? (next.active_element_id ?? null) : state.context.active_element_id,
        focused_owner_id: has('focused_owner_id') ? (next.focused_owner_id ?? null) : state.context.focused_owner_id,
        player_id: has('player_id') && typeof next.player_id === 'string' && next.player_id ? next.player_id : state.context.player_id,
        channel_id: has('channel_id') && typeof next.channel_id === 'string' && next.channel_id ? next.channel_id : state.context.channel_id,
        device_id: has('device_id') && typeof next.device_id === 'string' && next.device_id ? next.device_id : state.context.device_id,
        session_token: has('session_token') ? (typeof next.session_token === 'string' && next.session_token ? next.session_token : null) : state.context.session_token,
        actor_ref: has('actor_ref') ? (typeof next.actor_ref === 'string' && next.actor_ref ? next.actor_ref : null) : state.context.actor_ref,
        place_id: has('place_id') ? (typeof next.place_id === 'string' && next.place_id ? next.place_id : null) : state.context.place_id,
        move_mode: has('move_mode') && typeof next.move_mode === 'string' && next.move_mode ? next.move_mode : state.context.move_mode,
        principal_view: has('principal_view') && typeof next.principal_view === 'string' && next.principal_view ? next.principal_view : state.context.principal_view,
        roll_quarter_turn: has('roll_quarter_turn') && Number.isFinite(Number(next.roll_quarter_turn)) ? normalize_place_view_roll_quarter_turn(next.roll_quarter_turn) : state.context.roll_quarter_turn,
    };
    const tracePayload = {
        source: typeof next.source === 'string' ? next.source : 'unknown',
        web_contents_id: event.sender.id,
        typing: state.context.typing,
        actor_ref: state.context.actor_ref,
        place_id: state.context.place_id,
        session_token: state.context.session_token ? 'present' : 'missing',
        move_mode: state.context.move_mode,
        principal_view: state.context.principal_view,
        roll_quarter_turn: state.context.roll_quarter_turn,
    };
    const nextTraceKey = JSON.stringify(tracePayload);
    if (nextTraceKey !== state.lastContextTraceKey) {
        state.lastContextTraceKey = nextTraceKey;
        log_input_trace('context updated', tracePayload);
    }
});

ipcMain.on('gameplay-input-event', (event, payload) => {
    if (GAMEPLAY_INPUT_EVENT_SOURCE !== 'renderer_dom_bridge') return;
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    const state = get_gameplay_input_state(event.sender.id);
    const message = payload && typeof payload === 'object' ? payload : {};
    route_gameplay_keyboard_message(win, state, message, typeof message.source === 'string' ? message.source : 'renderer_dom_bridge');
});

ipcMain.on('tool-assisted-inputs-keyboard-event', (event, payload) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    const state = get_gameplay_input_state(event.sender.id);
    const message = payload && typeof payload === 'object' ? payload : {};
    route_gameplay_keyboard_message(win, state, message, 'tool_assisted_inputs');
});

ipcMain.on('tool-assisted-inputs-keyboard-reset', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    reset_gameplay_input(win, get_gameplay_input_state(event.sender.id), 'tool_assisted_inputs');
});

ipcMain.on('gameplay-input-request-snapshot', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    emit_snapshot(win, get_gameplay_input_state(event.sender.id));
});

ipcMain.on('gameplay-input-reset', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    reset_gameplay_input(win, get_gameplay_input_state(event.sender.id), 'renderer_reset');
});

app.whenReady().then(() => {
    create_window();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) create_window();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
