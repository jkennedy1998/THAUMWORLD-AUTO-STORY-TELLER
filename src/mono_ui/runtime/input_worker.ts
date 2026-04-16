/// <reference lib="webworker" />

import {
  SharedInputRuntime,
  default_input_context,
  type InputBindingsConfig,
} from './shared_input_runtime.js';
import type { InputWorkerRequest, InputWorkerResponse } from './input_worker_protocol.js';

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;
let runtime = new SharedInputRuntime();
const last_emitted_snapshot_revision = new Map<string, number>();

function attach_runtime_listener(): void {
  runtime.subscribe_move_intent_changes((intent, meta) => {
    const msg: InputWorkerResponse = {
      type: 'move_intent_changed',
      player_id: meta.player_id,
      intent,
      meta,
    };
    ctx.postMessage(msg);
    emit_snapshot(meta.player_id);
  });
}

function emit_snapshot(player_id = 'player_1', force = false): void {
  const snapshot = runtime.get_snapshot(player_id);
  const last_revision = last_emitted_snapshot_revision.get(player_id);
  if (!force && last_revision === snapshot.revision) return;
  last_emitted_snapshot_revision.set(player_id, snapshot.revision);
  const msg: InputWorkerResponse = {
    type: 'snapshot',
    snapshot,
  };
  ctx.postMessage(msg);
}

attach_runtime_listener();

ctx.onmessage = (event: MessageEvent<InputWorkerRequest>) => {
  const data = event.data;
  if (!data) return;
  switch (data.type) {
    case 'init': {
      runtime = new SharedInputRuntime(data.bindings as InputBindingsConfig);
      last_emitted_snapshot_revision.clear();
      attach_runtime_listener();
      const snapshot = runtime.get_snapshot('player_1');
      last_emitted_snapshot_revision.set('player_1', snapshot.revision);
      ctx.postMessage({ type: 'ready', snapshot } satisfies InputWorkerResponse);
      break;
    }
    case 'configure_bindings': {
      runtime.configure_bindings(data.bindings);
      emit_snapshot('player_1');
      break;
    }
    case 'keydown': {
      const resolved = default_input_context(data.ctx);
      runtime.ingest_keydown({
        code: data.ev.code,
        key: data.ev.key,
        repeat: data.ev.repeat,
        is_trusted: data.ev.is_trusted,
        player_id: resolved.player_id,
        channel_id: resolved.channel_id,
        device_id: resolved.device_id,
        typing: resolved.typing,
        window_focused: resolved.window_focused,
        active_element_id: resolved.active_element_id,
        focused_owner_id: resolved.focused_owner_id,
      });
      emit_snapshot(resolved.player_id);
      break;
    }
    case 'keyup': {
      const resolved = default_input_context(data.ctx);
      runtime.ingest_keyup({
        code: data.ev.code,
        key: data.ev.key,
        repeat: data.ev.repeat,
        is_trusted: data.ev.is_trusted,
        player_id: resolved.player_id,
        channel_id: resolved.channel_id,
        device_id: resolved.device_id,
        typing: resolved.typing,
        window_focused: resolved.window_focused,
        active_element_id: resolved.active_element_id,
        focused_owner_id: resolved.focused_owner_id,
      });
      emit_snapshot(resolved.player_id);
      break;
    }
    case 'reset': {
      runtime.reset_all(data.player_id ?? 'player_1');
      emit_snapshot(data.player_id ?? 'player_1');
      break;
    }
    case 'request_snapshot': {
      emit_snapshot(data.player_id ?? 'player_1', true);
      break;
    }
  }
};
