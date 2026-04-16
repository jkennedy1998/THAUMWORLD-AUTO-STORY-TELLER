import type {
  AutomationClockSource,
  AutomationInputDriver,
  AutomationPointerDriver,
  AutomationRuntimeProbe,
  AutomationScriptRepository,
  AutomationTraceSink,
  ToolAssistedInputsContext,
  ToolAssistedInputsScript,
  ToolAssistedInputsStatus,
  WorldSessionBootstrap,
} from './automation_interfaces.js';
import { create_tool_assisted_inputs_capture_store } from './automation_capture_store.js';
import { create_tool_assisted_inputs_diagnostic_report } from './automation_diagnostic_report.js';
import { execute_tool_assisted_inputs_action } from './automation_action_executor.js';
import { create_automation_timeline_scheduler } from './automation_timeline_scheduler.js';

let tool_assisted_inputs_active = false;

export function is_tool_assisted_inputs_active(): boolean {
  return tool_assisted_inputs_active;
}

function set_tool_assisted_inputs_active(next: boolean): void {
  tool_assisted_inputs_active = next;
}

type ToolAssistedInputsRuntimeOptions = {
  script_repository: AutomationScriptRepository;
  bootstrap: WorldSessionBootstrap;
  clock_source: AutomationClockSource;
  keyboard_driver: AutomationInputDriver;
  pointer_driver: AutomationPointerDriver;
  runtime_probe: AutomationRuntimeProbe;
  trace_sink: AutomationTraceSink;
};

const BOOT_READY_TIMEOUT_MS = 20_000;
const BREATH_ZERO_TIMEOUT_MS = 15_000;

function with_timeout<T>(promise: Promise<T>, timeout_ms: number, error_message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(error_message));
    }, timeout_ms);
    void promise.then((value) => {
      window.clearTimeout(timer);
      resolve(value);
    }).catch((error) => {
      window.clearTimeout(timer);
      reject(error);
    });
  });
}

export function create_tool_assisted_inputs_runtime(options: ToolAssistedInputsRuntimeOptions): {
  start: (script_ref: string) => Promise<void>;
  start_configured: () => Promise<void>;
  stop: () => Promise<void>;
  get_status: () => ToolAssistedInputsStatus;
} {
  let state: ToolAssistedInputsStatus['state'] = 'idle';
  let script_ref: string | null = null;
  let script_id: string | null = null;
  let backend_kind: string | null = null;
  let clock_origin: number | null = null;
  let last_clock_position: number | null = null;
  let next_action_index = 0;
  let error: string | null = null;
  let run_token = 0;
  let running_script: ToolAssistedInputsScript | null = null;
  let start_delay_timer: number | null = null;
  let breath_zero_timeout_timer: number | null = null;
  let completion_delay_timer: number | null = null;
  let unsubscribe_clock: (() => void) | null = null;
  let blur_cleanup_attached = false;
  const capture_store = create_tool_assisted_inputs_capture_store();
  const diagnostic_report = create_tool_assisted_inputs_diagnostic_report();
  let run_started_at_ms: number | null = null;
  let last_action_completed_at_ms: number | null = null;
  let scheduler: ReturnType<typeof create_automation_timeline_scheduler> | null = null;

  const handle_window_blur = (): void => {
    if (!is_tool_assisted_inputs_active()) return;
    void fail('tool_assisted_inputs_window_blur');
  };

  function get_status(): ToolAssistedInputsStatus {
    return {
      active: is_tool_assisted_inputs_active(),
      state,
      script_ref,
      script_id,
      backend_kind,
      breath_zero: clock_origin,
      last_tick_index: last_clock_position,
      next_action_index,
      error,
    };
  }

  function emit(event: Parameters<AutomationTraceSink['emit']>[0], payload: Record<string, unknown> = {}): void {
    options.trace_sink.emit(event, {
      script_ref,
      script_id,
      backend_kind,
      breath_zero: clock_origin,
      last_tick_index: last_clock_position,
      next_action_index,
      ...payload,
    });
  }

  async function cleanup(next_state: ToolAssistedInputsStatus['state']): Promise<void> {
    if (start_delay_timer !== null) {
      window.clearTimeout(start_delay_timer);
      start_delay_timer = null;
    }
    if (breath_zero_timeout_timer !== null) {
      window.clearTimeout(breath_zero_timeout_timer);
      breath_zero_timeout_timer = null;
    }
    if (completion_delay_timer !== null) {
      window.clearTimeout(completion_delay_timer);
      completion_delay_timer = null;
    }
    if (unsubscribe_clock) {
      unsubscribe_clock();
      unsubscribe_clock = null;
    }
    if (blur_cleanup_attached) {
      window.removeEventListener('blur', handle_window_blur);
      blur_cleanup_attached = false;
    }
    try {
      await Promise.resolve(options.keyboard_driver.reset());
    } catch {
      // ignore cleanup failures
    }
    set_tool_assisted_inputs_active(false);
    running_script = null;
    diagnostic_report.reset();
    capture_store.reset();
    run_started_at_ms = null;
    last_action_completed_at_ms = null;
    scheduler = null;
    state = next_state;
  }

  async function fail(message: string): Promise<void> {
    error = message;
    emit('failed', { error: message });
    await cleanup('failed');
  }

  async function complete(): Promise<void> {
    const actual_open_ms = run_started_at_ms !== null ? Math.max(0, Date.now() - run_started_at_ms) : null;
    const actual_end_delay_ms = last_action_completed_at_ms !== null ? Math.max(0, Date.now() - last_action_completed_at_ms) : null;
    emit('run_summary', {
      diagnostic_passed: diagnostic_report.passed(),
      diagnostic_failure_count: diagnostic_report.failure_count(),
      captured_slots: capture_store.list_tile_slots(),
      captured_trace_slots: capture_store.list_movement_trace_slots(),
      captured_visible_step_slots: capture_store.list_visible_step_slots(),
      open_ms: running_script?.open_ms ?? null,
      end_delay_ms: running_script?.end_delay_ms ?? null,
      actual_open_ms,
      actual_end_delay_ms,
    });
    emit('completed');
    await cleanup('completed');
  }

  async function stop(): Promise<void> {
    run_token += 1;
    if (state !== 'idle' && state !== 'completed' && state !== 'failed' && state !== 'stopped') {
      emit('stopped');
    }
    error = null;
    await cleanup('stopped');
  }

  async function process_tick(current_tick: number, token: number): Promise<void> {
    if (token !== run_token) return;
    last_clock_position = current_tick;
    if (!running_script || !scheduler) return;
    if (state === 'waiting_for_breath_zero') {
      if (breath_zero_timeout_timer !== null) {
        window.clearTimeout(breath_zero_timeout_timer);
        breath_zero_timeout_timer = null;
      }
      const scheduler_update = scheduler.update_from_clock({
        mode: running_script.clock_mode,
        position: current_tick,
        ready: true,
        source: 'runtime_clock_sample',
      });
      if (scheduler_update.origin_established) {
        clock_origin = scheduler.get_origin_position();
        state = 'running';
        emit('breath_zero', { breath_zero: clock_origin });
      }
    }
    if (state !== 'running' || clock_origin === null) return;
    const context = options.bootstrap.get_current_context();
    const scheduler_update = scheduler.update_from_clock({
      mode: running_script.clock_mode,
      position: current_tick,
      ready: true,
      source: 'runtime_clock_sample',
    });
    for (const action_index of scheduler_update.due_action_indexes) {
      const action = running_script.actions[action_index]!;
      const target_tick = scheduler.get_action_target_position(action) ?? current_tick;
      const ok = await execute_tool_assisted_inputs_action({
        action,
        action_index,
        current_tick,
        target_breath: target_tick,
        context,
        runtime_probe: options.runtime_probe,
        keyboard_driver: options.keyboard_driver,
        pointer_driver: options.pointer_driver,
        capture_store,
        diagnostic_report,
        emit,
        mark_action_completed: () => {
          last_action_completed_at_ms = Date.now();
        },
      });
      if (!ok) {
        if (running_script?.stop_on_error !== false) {
          await fail('tool_assisted_inputs_action_failed');
        }
        return;
      }
      next_action_index = scheduler.get_next_action_index();
    }
    if (running_script && scheduler.has_completed_actions()) {
      if (completion_delay_timer === null) {
        const end_delay_ms = Math.max(0, running_script.end_delay_ms || 0);
        completion_delay_timer = window.setTimeout(() => {
          completion_delay_timer = null;
          scheduler?.mark_completed();
          void complete();
        }, end_delay_ms);
      }
    }
  }

  async function start(script_ref_input: string): Promise<void> {
    await stop();
    const token = run_token + 1;
    run_token = token;
    error = null;
    state = 'booting';
    set_tool_assisted_inputs_active(true);
    run_started_at_ms = Date.now();
    script_ref = script_ref_input;
    next_action_index = 0;
    clock_origin = null;
    last_clock_position = null;
    backend_kind = options.keyboard_driver.backend_kind;
    await Promise.resolve(options.script_repository.set_last_script_ref(script_ref_input));
    try {
      const loaded = await options.script_repository.load_script(script_ref_input);
      if (token !== run_token) return;
      running_script = loaded.script;
      script_ref = loaded.resolved_ref;
      script_id = loaded.script.id ?? null;
      diagnostic_report.reset();
      capture_store.reset();
      scheduler = create_automation_timeline_scheduler({
        clock_mode: loaded.script.clock_mode,
        actions: loaded.script.actions,
        start_delay_ms: loaded.script.start_delay_ms,
        end_delay_ms: loaded.script.end_delay_ms,
      });
      emit('run_header', {
        test_name: loaded.script.test_name,
        clock_mode: loaded.script.clock_mode,
        open_ms: loaded.script.open_ms,
        end_delay_ms: loaded.script.end_delay_ms,
        action_count: loaded.script.actions.length,
        start_delay_ms: loaded.script.start_delay_ms,
        description: loaded.script.description ?? null,
        tai_id: (window as Window).electronAPI?.toolAssistedInputsBootConfig?.taiId ?? null,
        tai_test_name: (window as Window).electronAPI?.toolAssistedInputsBootConfig?.testName ?? loaded.script.test_name,
        tai_open_ms: (window as Window).electronAPI?.toolAssistedInputsBootConfig?.openMs ?? loaded.script.open_ms,
        tai_end_delay_ms: (window as Window).electronAPI?.toolAssistedInputsBootConfig?.endDelayMs ?? loaded.script.end_delay_ms,
      });
      emit('script_loaded', {
        test_name: loaded.script.test_name,
        clock_mode: loaded.script.clock_mode,
        open_ms: loaded.script.open_ms,
        end_delay_ms: loaded.script.end_delay_ms,
        action_count: loaded.script.actions.length,
        start_delay_ms: loaded.script.start_delay_ms,
        description: loaded.script.description ?? null,
      });
      emit('boot_started', {
        test_name: loaded.script.test_name,
        auto_claim: Boolean(loaded.script.boot?.auto_claim),
        timeout_ms: BOOT_READY_TIMEOUT_MS,
      });
      const context = await with_timeout(options.bootstrap.ensure_ready(loaded.script.boot), BOOT_READY_TIMEOUT_MS, 'tool_assisted_inputs_boot_timeout');
      if (token !== run_token) return;
      emit('boot_ready', {
        test_name: loaded.script.test_name,
        actor_ref: context.actor_ref,
        place_id: context.place_id,
        session_token: context.session_token ? 'present' : 'missing',
      });
      state = 'waiting_start_delay';
      emit('waiting_start_delay', {
        test_name: loaded.script.test_name,
        clock_mode: loaded.script.clock_mode,
        start_delay_ms: loaded.script.start_delay_ms,
        end_delay_ms: loaded.script.end_delay_ms,
        breath_zero_timeout_ms: BREATH_ZERO_TIMEOUT_MS,
      });
      if (!blur_cleanup_attached) {
        window.addEventListener('blur', handle_window_blur);
        blur_cleanup_attached = true;
      }
      unsubscribe_clock = options.clock_source.subscribe((sample) => {
        void process_tick(sample.position, token);
      });
      start_delay_timer = window.setTimeout(() => {
        if (token !== run_token) return;
        const arm_result = scheduler?.arm_after_start_delay(options.clock_source.get_snapshot());
        if (arm_result?.origin_established) {
          clock_origin = scheduler?.get_origin_position() ?? null;
          state = 'running';
          emit('breath_zero', { breath_zero: clock_origin });
        } else {
          state = 'waiting_for_breath_zero';
          breath_zero_timeout_timer = window.setTimeout(() => {
            if (token !== run_token || state !== 'waiting_for_breath_zero') return;
            void fail('tool_assisted_inputs_breath_zero_timeout');
          }, BREATH_ZERO_TIMEOUT_MS);
        }
      }, loaded.script.start_delay_ms);
    } catch (err) {
      if (token !== run_token) return;
      const message = err instanceof Error ? err.message : String(err);
      await fail(message);
    }
  }

  async function start_configured(): Promise<void> {
    const configured_ref = await options.script_repository.get_autostart_script_ref();
    if (!configured_ref) return;
    await start(configured_ref);
  }

  return {
    start,
    start_configured,
    stop,
    get_status,
  };
}
