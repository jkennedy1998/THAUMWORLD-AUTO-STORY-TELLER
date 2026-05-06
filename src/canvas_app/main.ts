import { CanvasRuntime } from '../mono_ui/runtime/canvas_runtime.js';
import type { Module } from '../mono_ui/types.js';
import { compute_dom_viewport_for_rect } from '../mono_ui/runtime/dom_viewport.js';
import { clamp_ui_scale, compute_responsive_grid_size, get_ui_cell_metrics } from '../mono_ui/runtime/ui_metrics.js';
import { get_theme_font_primary_family, THAUMWORLD_RENDER_THEME } from '../mono_ui/runtime/render_theme.js';
import { install_runtime_diagnostics_api } from '../shared/diagnostics.js';
import { APP_CONFIG, create_app_state } from './app_state.js';
import { PAINTER_CONFIG, create_painter_app_state } from './painter_app_state.js';
import { apply_painter_multiplayer_transport_config } from './painter_runtime_config.js';
import { create_launch_controller } from '../engine_launch/controller.js';
import { create_join_controller } from '../engine_launch/join_controller.js';
import { save_manual_connection } from '../engine_multiplayer/connection_store.js';
import { record_successful_connection_for_content, resolve_preferred_join_record_for_content_refs } from '../engine_multiplayer/join_preference_store.js';
import { create_painter_launch_adapter, resolve_painter_tai_boot_intent, resolve_painter_tai_join_request } from './painter_launch_adapter.js';
import { create_painter_file_content_ref, create_painter_remote_document_content_ref } from './painter_content_refs.js';
import type { PainterLaunchIntent } from './painter_launch_types.js';
import { diag_log } from '../shared/diagnostics.js';
import type { EngineJoinSelection } from '../engine_multiplayer/connection_types.js';
import type { ToolAssistedInputsJoinSnapshot } from '../mono_ui/runtime/automation_interfaces.js';
import { load_ui_customization_state } from '../mono_ui/runtime/ui_customization_store.js';
import { resolve_profile_scope } from '../user_profiles/named_profile_store.js';
import { loadToolProperties } from '../ascii_painter/save_system.js';
import { get_color_by_name } from '../mono_ui/colors.js';

// Detect if we're in painter mode (set by preload script before page loads)
const IS_PAINTER_MODE = (window as any).electronAPI?.appMode === 'ascii_painter';
const PAINTER_BOOT_ROLE = String((window as any).electronAPI?.bootRole ?? '').trim().toLowerCase();
const PAINTER_LAUNCH_MODE = String((window as any).electronAPI?.launchMode ?? '').trim().toLowerCase();
const PAINTER_STARTUP_JOIN_CONFIG = (window as any).electronAPI?.startupJoinConfig ?? {};

const el = document.getElementById('mono_canvas') as HTMLCanvasElement | null;
if (!el) throw new Error('mono_canvas element not found');
const canvasEl = el;

install_runtime_diagnostics_api();

let modules: readonly Module[];
let module_registry: any;
let on_drag_end_outside: ((x: number, y: number) => void) | undefined;
let on_pointer_move_global: ((x: number, y: number, e: any) => void) | undefined;
let on_pointer_down_global: ((x: number, y: number, e: any) => void) | undefined;
let on_pointer_up_global: ((x: number, y: number, e: any) => void) | undefined;
let on_after_compose: ((canvas: any) => void) | undefined;
let launch_controller: ReturnType<typeof create_launch_controller<PainterLaunchIntent>> | null = null;
let painter_join_controller: ReturnType<typeof create_join_controller> | null = null;
let launchPainterIntent: ((intent: PainterLaunchIntent) => Promise<void>) | null = null;
let painter_join_visible = false;
let painter_tai_join_snapshot: ToolAssistedInputsJoinSnapshot | null = null;
const get_painter_tai_join_snapshot = () => painter_tai_join_snapshot ?? painter_join_controller?.get_tai_join_snapshot() ?? null;

let painter_state: ReturnType<typeof create_painter_app_state> | null = null;
let game_state: ReturnType<typeof create_app_state> | null = null;
let runtime!: CanvasRuntime;

const refresh_painter_shell_modules = () => {
    if (!launch_controller || !painter_join_controller) return;
    modules = painter_join_visible
        ? [...launch_controller.modules, ...painter_join_controller.modules]
        : [...launch_controller.modules];
    if (runtime) runtime.set_modules(get_visible_modules());
};

if (IS_PAINTER_MODE) {
    console.log('🎨 Initializing ASCII Painter Launch...');
    try {
        const painter_profile_scope = await resolve_profile_scope(PAINTER_CONFIG.selected_data_slot, 'thaum_painter');
        const saved_tool_props = loadToolProperties();
        await load_ui_customization_state(PAINTER_CONFIG.selected_data_slot, {
            profile_scope: painter_profile_scope,
            vivid_seed_rgb: saved_tool_props.user_selection_color_rgb ?? get_color_by_name('pumpkin').rgb,
        });
    } catch {
        // Keep default semantic colors if painter profile customization preload fails.
    }
    const get_launch_resume_file_path = (): string | null => {
        const candidate = launch_controller?.get_state().resume_candidate;
        return candidate?.source.kind === 'file' ? String(candidate.source.path ?? '').trim() || null : null;
    };
    const get_active_join_content_refs = () => {
        const active_refs = painter_state?.get_active_join_content_refs() ?? [];
        if (active_refs.length > 0) return active_refs;
        const resume_file_path = get_launch_resume_file_path();
        return resume_file_path ? [create_painter_file_content_ref(resume_file_path)] : [];
    };
    launchPainterIntent = async (intent: PainterLaunchIntent) => {
        painter_state = create_painter_app_state({ skip_boot_restore: true, skip_multiplayer_bootstrap: true, get_join_snapshot: get_painter_tai_join_snapshot });
        await painter_state.start_from_launch_intent(intent);
        modules = painter_state.modules;
        module_registry = painter_state.module_registry;
        on_drag_end_outside = undefined;
        on_pointer_move_global = painter_state.on_pointer_move_global;
        on_pointer_down_global = painter_state.on_pointer_down_global;
        on_pointer_up_global = painter_state.on_pointer_up_global;
        on_after_compose = undefined;
        runtime.set_modules(get_visible_modules());
        if (module_registry?.subscribe) {
            module_registry.subscribe(() => {
                runtime.set_modules(get_visible_modules());
            });
        }
        painter_state.init_dom_renderer();
        (window as any).painter = {
            export: painter_state.export_grid,
            import: painter_state.import_grid,
            clear: painter_state.clear_canvas,
            save: painter_state.save_to_file,
            load: painter_state.load_from_file,
            new_canvas: painter_state.new_canvas,
            export_text: painter_state.export_as_text,
            filename: () => painter_state!.current_filename,
            multiplayer: painter_state.multiplayer_sync,
        };
    };
    const launch_painter_join_selection = async (selection: EngineJoinSelection) => {
        painter_tai_join_snapshot = painter_join_controller?.get_tai_join_snapshot() ?? painter_tai_join_snapshot;
        apply_painter_multiplayer_transport_config({
            host_input: selection.connection.host,
            api_base_url: selection.transport.api_base_url,
            bridge_ws_base_url: selection.transport.bridge_ws_base_url,
        });
        const document_id = String(selection.probe?.painter_document_id ?? '').trim();
        if (!document_id) {
            throw new Error(`painter_join_unavailable:${selection.connection.id}`);
        }
        console.log('[PAINTER_JOIN]', JSON.stringify({
            connection_id: selection.connection.id,
            connection_name: selection.connection.name,
            host: selection.connection.host,
            api_base_url: selection.transport.api_base_url,
            bridge_ws_base_url: selection.transport.bridge_ws_base_url,
            document_id,
            display_name: selection.probe?.painter_display_name ?? selection.connection.name,
        }));
        painter_join_visible = false;
        refresh_painter_shell_modules();
        await launchPainterIntent?.({
            kind: 'join_authoritative',
            slot: PAINTER_CONFIG.selected_data_slot,
            document_id,
            display_name: String(selection.probe?.painter_display_name ?? selection.connection.name ?? 'untitled'),
            join_target_id: selection.connection.id,
            api_base_url: selection.transport.api_base_url,
            bridge_ws_base_url: selection.transport.bridge_ws_base_url,
            persist_recent: false,
        });
        const active_content_refs = get_active_join_content_refs();
        const file_content_ref = active_content_refs.find((ref) => ref.kind === 'file') ?? null;
        if (file_content_ref?.value) {
            await record_successful_connection_for_content(PAINTER_CONFIG.selected_data_slot, {
                content_ref: file_content_ref,
                selection,
                transport_strategy: 'direct',
                app_metadata: {
                    path: String(file_content_ref.value),
                    document_id,
                    display_name: String(selection.probe?.painter_display_name ?? selection.connection.name ?? 'untitled'),
                },
            });
        }
        await record_successful_connection_for_content(PAINTER_CONFIG.selected_data_slot, {
            content_ref: create_painter_remote_document_content_ref(
                document_id,
            ),
            selection,
            transport_strategy: 'direct',
            app_metadata: {
                document_id,
                display_name: String(selection.probe?.painter_display_name ?? selection.connection.name ?? 'untitled'),
            },
        });
    };
    painter_join_controller = create_join_controller({
        id: 'painter_join_module',
        rect: { x0: 16, y0: 7, x1: 104, y1: 31 },
        title: 'JOIN PAINTING',
        slot: PAINTER_CONFIG.selected_data_slot,
        get_is_visible: () => painter_join_visible,
        on_join_selection: launch_painter_join_selection,
        on_back: () => {
            painter_join_visible = false;
            refresh_painter_shell_modules();
        },
    });
    launch_controller = create_launch_controller<PainterLaunchIntent>({
        id: 'painter_launch_module',
        rect: { x0: 22, y0: 10, x1: 62, y1: 28 },
        adapter: create_painter_launch_adapter(),
        on_launch_intent: launchPainterIntent,
        on_join_requested: async () => {
            if (PAINTER_LAUNCH_MODE === 'host-only') {
                console.warn('[PAINTER_JOIN_MODE]', JSON.stringify({ event: 'join_ui_blocked_for_host_role', boot_role: PAINTER_BOOT_ROLE }));
                return;
            }
            painter_join_visible = true;
            refresh_painter_shell_modules();
            await painter_join_controller?.refresh();
            const active_content_refs = get_active_join_content_refs();
            if (active_content_refs.length > 0) {
                try {
                    const resolved = await resolve_preferred_join_record_for_content_refs(
                        PAINTER_CONFIG.selected_data_slot,
                        active_content_refs,
                    );
                    const preference = resolved?.record ?? null;
                    const selected = preference?.preferred_connection_id
                        ? painter_join_controller?.select_connection_by_id(preference.preferred_connection_id)
                        : false;
                    if (!selected && preference?.preferred_host) {
                        painter_join_controller?.select_connection_by_host(preference.preferred_host);
                    }
                    console.log('[PAINTER_JOIN_PREFERENCE]', JSON.stringify({
                        event: 'preferred_target_applied',
                        slot: PAINTER_CONFIG.selected_data_slot,
                        content_ref_kind: resolved?.matched_content_ref.kind ?? null,
                        content_ref_value: resolved?.matched_content_ref.value ?? null,
                        preferred_connection_id: preference?.preferred_connection_id ?? null,
                        preferred_host: preference?.preferred_host ?? null,
                        matched_by: selected ? 'connection_id' : (preference?.preferred_host ? 'host' : 'none'),
                    }));
                } catch (error) {
                    console.warn('[PAINTER_JOIN_PREFERENCE]', JSON.stringify({
                        event: 'preferred_target_lookup_failed',
                        slot: PAINTER_CONFIG.selected_data_slot,
                        content_ref_count: active_content_refs.length,
                        message: error instanceof Error ? error.message : String(error),
                    }));
                }
            }
        },
    });
    refresh_painter_shell_modules();
    module_registry = null;
    on_drag_end_outside = undefined;
    on_pointer_move_global = undefined;
    on_pointer_down_global = undefined;
    on_pointer_up_global = undefined;
    on_after_compose = undefined;
} else {
    // GAME MODE
    console.log('🎮 Initializing Game...');
    game_state = create_app_state();
    modules = game_state.modules;
    module_registry = game_state.module_registry;
    on_drag_end_outside = game_state.on_drag_end_outside;
    on_pointer_move_global = game_state.on_pointer_move_global;
    on_pointer_down_global = game_state.on_pointer_down_global;
    on_pointer_up_global = game_state.on_pointer_up_global;
    on_after_compose = game_state.on_after_compose;
}

const config = IS_PAINTER_MODE ? PAINTER_CONFIG : APP_CONFIG;
function get_layout_state() {
    return IS_PAINTER_MODE ? painter_state : game_state;
}

function compute_responsive_grid(scale: number): { width: number; height: number } | null {
    const viewport = canvasEl.parentElement;
    if (!viewport) return null;
    return compute_responsive_grid_size(viewport.clientWidth, viewport.clientHeight, scale);
}

function get_visible_modules(): readonly Module[] {
    if (!module_registry?.get_all) return modules;
    const all = module_registry.get_all() as readonly Module[];
    if (!module_registry.is_visible) return all;
    return all.filter((m: any) => {
        try {
            return module_registry.is_visible(m.id);
        } catch {
            return true;
        }
    });
}

runtime = new CanvasRuntime({
    canvas: canvasEl,
    grid_width: config.grid_width,
    grid_height: config.grid_height,
    font_family: config.font_family,
    base_font_size_px: config.base_font_size_px,
    base_line_height_mult: config.base_line_height_mult,
    base_letter_spacing_mult: config.base_letter_spacing_mult,
    weight_index_to_css: config.weight_index_to_css,
    render_backend: config.render_backend,
    render_theme_id: config.render_theme_id,
    modules: get_visible_modules(),
    on_drag_end_outside: (x, y) => on_drag_end_outside?.(x, y),
    on_pointer_move_global: (x, y, e) => on_pointer_move_global?.(x, y, e),
    on_pointer_down_global: (x, y, e) => on_pointer_down_global?.(x, y, e),
    on_pointer_up_global: (x, y, e) => on_pointer_up_global?.(x, y, e),
    on_after_compose: (canvas) => on_after_compose?.(canvas),
});

if (IS_PAINTER_MODE && launch_controller && painter_join_controller) {
    modules = [...launch_controller.modules];
    runtime.set_modules(get_visible_modules());
}

(window as any).TOOL_ASSISTED_INPUTS_RUNTIME = {
    inject_gameplay_key: (type: 'keydown' | 'keyup', payload: { code: string; key?: string; repeat?: boolean }) => {
        runtime.inject_tool_assisted_gameplay_key(type, payload);
    },
    inject_ui_key: (type: 'keydown' | 'keyup', payload: { code: string; key?: string; repeat?: boolean }) => {
        runtime.inject_tool_assisted_ui_key(type, payload);
    },
    inject_text_input: (payload: { text: string }) => {
        runtime.inject_tool_assisted_text_input(payload);
    },
    focus_module: (module_id: string) => {
        return runtime.focus_module_by_id(module_id);
    },
    inject_pointer_move: (payload: any) => {
        runtime.inject_tool_assisted_pointer_move(payload);
    },
    inject_pointer_down: (payload: any) => {
        runtime.inject_tool_assisted_pointer_down(payload);
    },
    inject_pointer_up: (payload: any) => {
        runtime.inject_tool_assisted_pointer_up(payload);
    },
    inject_pointer_click: (payload: any, click_count: 1 | 2) => {
        runtime.inject_tool_assisted_pointer_click(payload, click_count);
    },
    inject_context_menu: (payload: any) => {
        runtime.inject_tool_assisted_context_menu(payload);
    },
    inject_pointer_drag: (payload: any) => {
        runtime.inject_tool_assisted_pointer_drag(payload);
    },
    inject_wheel: (payload: any) => {
        runtime.inject_tool_assisted_wheel(payload);
    },
    reset_keyboard: () => {
        runtime.reset_keyboard_state();
    },
};

function apply_responsive_layout(scale: number): void {
    const next = compute_responsive_grid(scale);
    if (!next) return;
    runtime.set_grid_size(next.width, next.height);
    get_layout_state()?.update_layout(next.width, next.height);
}

// Subscribe to module registry changes
if (module_registry) {
    module_registry.subscribe(() => {
        runtime.set_modules(get_visible_modules());
    });
}

if (IS_PAINTER_MODE && launch_controller) {
    void (async () => {
        const preferredStartupHost = String(PAINTER_STARTUP_JOIN_CONFIG?.preferredHost ?? '').trim();
        const startupJoinAutoOpen = Boolean(PAINTER_STARTUP_JOIN_CONFIG?.autoOpen);
        if (preferredStartupHost) {
            try {
                const saved = save_manual_connection(preferredStartupHost, preferredStartupHost);
                console.log('[PAINTER_JOIN_STARTUP]', JSON.stringify({
                    event: 'manual_startup_host_seeded',
                    boot_role: PAINTER_BOOT_ROLE || null,
                    preferred_host: preferredStartupHost,
                    connection_id: saved.id,
                }));
            } catch (error) {
                console.warn('[PAINTER_JOIN_STARTUP]', JSON.stringify({
                    event: 'manual_startup_host_seed_failed',
                    boot_role: PAINTER_BOOT_ROLE || null,
                    preferred_host: preferredStartupHost,
                    message: error instanceof Error ? error.message : String(error),
                }));
            }
            if (startupJoinAutoOpen && painter_join_controller) {
                painter_join_visible = true;
                refresh_painter_shell_modules();
                await painter_join_controller.refresh();
                const selected = painter_join_controller.select_connection_by_host(preferredStartupHost);
                console.log('[PAINTER_JOIN_STARTUP]', JSON.stringify({
                    event: 'manual_startup_join_opened',
                    boot_role: PAINTER_BOOT_ROLE || null,
                    launch_mode: PAINTER_LAUNCH_MODE || null,
                    preferred_host: preferredStartupHost,
                    selected,
                    selected_connection_id: painter_join_controller.get_selected_connection_id(),
                }));
                return;
            }
        }
        const taiBootIntent = await resolve_painter_tai_boot_intent();
        if (taiBootIntent) {
        await launchPainterIntent?.(taiBootIntent);
        return;
      }
        const taiJoinRequest = resolve_painter_tai_join_request();
        if (taiJoinRequest && painter_join_controller) {
            painter_join_visible = true;
            refresh_painter_shell_modules();
            await painter_join_controller.apply_tai_join_request(taiJoinRequest);
            painter_tai_join_snapshot = painter_join_controller.get_tai_join_snapshot();
            return;
        }
        await launch_controller!.refresh();
    })();
}

// Hook DOM renderer into render loop for painter mode
if (IS_PAINTER_MODE) {
    const originalTick = (runtime as any)['tick'].bind(runtime);
    
    // Track tile size and global pan offset for viewport calculations
    let tileSize = { w: 0, h: 0 };
    let globalPan = { x: 0, y: 0 };
    let uiScale = 1.0;
    let gotPanEvent = false;
    let boot_frames_left = 10;
    let boot_recentering_done = false;
    let forcePainterViewportResync = false;

    function computeTileMetrics(scale: number): { tileW: number; tileH: number; fontSizePx: number } | null {
        const metrics = get_ui_cell_metrics(scale, config.base_font_size_px);
        return {
            tileW: metrics.cell_w_px,
            tileH: metrics.cell_h_px,
            fontSizePx: metrics.font_size_px,
        };
    }
    
    // Listen to canvas pan events for tile size and global pan updates
    window.addEventListener('thaumworld_ui_pan', ((ev: CustomEvent) => {
        tileSize.w = ev.detail?.tile_w_px ?? 0;
        tileSize.h = ev.detail?.tile_h_px ?? 0;
        // Track global pan offset from mono_canvas CSS transform
        globalPan.x = ev.detail?.pan_x_px ?? 0;
        globalPan.y = ev.detail?.pan_y_px ?? 0;
        uiScale = ev.detail?.scale ?? uiScale;
        gotPanEvent = true;
        
        // (debug logging removed)
    }) as EventListener);
    
    let lastViewportLogKey = '';
    let lastPainterViewportInvalidReason = '';
    let lastPainterViewportStateKey = '';

    const logPainterViewportIssue = (reason: string, extra?: Record<string, unknown>) => {
        const key = JSON.stringify({ reason, ...(extra ?? {}) });
        if (key === lastPainterViewportInvalidReason) return;
        lastPainterViewportInvalidReason = key;
        diag_log('painter', 'important', 'PAINTER_VIEWPORT_DEBUG', reason, {
            tile_w: tileSize.w,
            tile_h: tileSize.h,
            global_pan_x: Math.round(globalPan.x),
            global_pan_y: Math.round(globalPan.y),
            got_pan_event: gotPanEvent,
            ui_scale: uiScale,
            boot_frames_left,
            canvas_rect: {
                x: Math.round(canvasEl.getBoundingClientRect().x),
                y: Math.round(canvasEl.getBoundingClientRect().y),
                width: Math.round(canvasEl.getBoundingClientRect().width),
                height: Math.round(canvasEl.getBoundingClientRect().height),
            },
            visibility_state: document.visibilityState,
            window_focused: document.hasFocus(),
            ...extra,
        });
    };

    const logPainterViewportState = (reason: string, extra?: Record<string, unknown>) => {
        const key = JSON.stringify({ reason, ...(extra ?? {}) });
        if (key === lastPainterViewportStateKey) return;
        lastPainterViewportStateKey = key;
        diag_log('painter', 'important', 'PAINTER_VIEWPORT_DEBUG', reason, {
            tile_w: tileSize.w,
            tile_h: tileSize.h,
            global_pan_x: Math.round(globalPan.x),
            global_pan_y: Math.round(globalPan.y),
            got_pan_event: gotPanEvent,
            ui_scale: uiScale,
            boot_frames_left,
            canvas_rect: {
                x: Math.round(canvasEl.getBoundingClientRect().x),
                y: Math.round(canvasEl.getBoundingClientRect().y),
                width: Math.round(canvasEl.getBoundingClientRect().width),
                height: Math.round(canvasEl.getBoundingClientRect().height),
            },
            visibility_state: document.visibilityState,
            window_focused: document.hasFocus(),
            ...extra,
        });
    };

    try {
        window.addEventListener('focus', () => {
            forcePainterViewportResync = true;
            diag_log('painter', 'important', 'PAINTER_VIEWPORT_DEBUG', 'window focus observed', {
                visibility_state: document.visibilityState,
                window_focused: document.hasFocus(),
                canvas_rect: {
                    x: Math.round(canvasEl.getBoundingClientRect().x),
                    y: Math.round(canvasEl.getBoundingClientRect().y),
                    width: Math.round(canvasEl.getBoundingClientRect().width),
                    height: Math.round(canvasEl.getBoundingClientRect().height),
                },
                tile_w: tileSize.w,
                tile_h: tileSize.h,
                got_pan_event: gotPanEvent,
            });
        });
        window.addEventListener('blur', () => {
            diag_log('painter', 'important', 'PAINTER_VIEWPORT_DEBUG', 'window blur observed', {
                visibility_state: document.visibilityState,
                window_focused: document.hasFocus(),
                canvas_rect: {
                    x: Math.round(canvasEl.getBoundingClientRect().x),
                    y: Math.round(canvasEl.getBoundingClientRect().y),
                    width: Math.round(canvasEl.getBoundingClientRect().width),
                    height: Math.round(canvasEl.getBoundingClientRect().height),
                },
                tile_w: tileSize.w,
                tile_h: tileSize.h,
                got_pan_event: gotPanEvent,
            });
        });
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                forcePainterViewportResync = true;
            }
            diag_log('painter', 'important', 'PAINTER_VIEWPORT_DEBUG', 'document visibilitychange observed', {
                visibility_state: document.visibilityState,
                window_focused: document.hasFocus(),
                canvas_rect: {
                    x: Math.round(canvasEl.getBoundingClientRect().x),
                    y: Math.round(canvasEl.getBoundingClientRect().y),
                    width: Math.round(canvasEl.getBoundingClientRect().width),
                    height: Math.round(canvasEl.getBoundingClientRect().height),
                },
                tile_w: tileSize.w,
                tile_h: tileSize.h,
                got_pan_event: gotPanEvent,
            });
        });
        window.addEventListener('resize', () => {
            forcePainterViewportResync = true;
            diag_log('painter', 'important', 'PAINTER_VIEWPORT_DEBUG', 'window resize observed', {
                visibility_state: document.visibilityState,
                window_focused: document.hasFocus(),
                canvas_rect: {
                    x: Math.round(canvasEl.getBoundingClientRect().x),
                    y: Math.round(canvasEl.getBoundingClientRect().y),
                    width: Math.round(canvasEl.getBoundingClientRect().width),
                    height: Math.round(canvasEl.getBoundingClientRect().height),
                },
                tile_w: tileSize.w,
                tile_h: tileSize.h,
                got_pan_event: gotPanEvent,
            });
        });
    } catch {
        // ignore
    }

    (runtime as any)['tick'] = () => {
        const painterRef = painter_state;
        if (!painterRef) {
            originalTick();
            return;
        }
        // During the first few frames after boot the DOM/layout/font metrics can settle.
        // We re-sample metrics and canvas position to avoid a "snap" that only corrects
        // itself after the first manual global pan.
        const bootWarmup = boot_frames_left > 0;
        const forceResync = forcePainterViewportResync;
        if (forceResync) {
            gotPanEvent = false;
            logPainterViewportState('forcing painter viewport resync on restore-sensitive tick', {
                reason: 'focus_visibility_or_resize',
            });
        }

        // Ensure we have sane initial metrics even before the first pan event.
        // On some boots the first recenter can run before the window layout is stable,
        // so we fall back to DOM + derived font metrics until events arrive.
        if (tileSize.w <= 0 || tileSize.h <= 0 || bootWarmup || forceResync) {
            const m = computeTileMetrics(runtime.get_scale());
            if (m) {
                tileSize.w = m.tileW;
                tileSize.h = m.tileH;
                uiScale = runtime.get_scale();
            }
        }

        if (!gotPanEvent || bootWarmup || forceResync) {
            const r = canvasEl.getBoundingClientRect();
            if (Number.isFinite(r.left) && Number.isFinite(r.top)) {
                globalPan.x = r.left;
                globalPan.y = r.top;
            }
        }

        // Force a single recenter pass once the first couple frames have rendered.
        // This mimics the "first manual pan" correction, but happens automatically.
        if (!gotPanEvent && bootWarmup && !boot_recentering_done && boot_frames_left <= 8) {
            boot_recentering_done = true;
            const s = runtime.get_scale();
            runtime.set_scale(s);
        }

        // IMPORTANT: Set viewport FIRST, then render DOM layers
        // This ensures the DOM renderer uses the current viewport position
        const currentModules: readonly Module[] = module_registry?.get_all ? module_registry.get_all() : modules;
        const canvasModule = currentModules.find(m => m.id === 'painter_canvas');
        if (canvasModule && tileSize.w > 0 && tileSize.h > 0) {
            const rect = canvasModule.rect;

            // Viewport in screen CSS pixels.
            // Keep painter + game-place aligned by reusing the shared helper.
            const vp = compute_dom_viewport_for_rect({
                pan_x_px: globalPan.x,
                pan_y_px: globalPan.y,
                tile_w_px: tileSize.w,
                tile_h_px: tileSize.h,
                grid_height: config.grid_height,
                rect,
                base_font_size_px: config.base_font_size_px,
                ui_scale: uiScale,
            });
            if (vp) {
                lastPainterViewportInvalidReason = '';
                const logKey = `${vp.x.toFixed(2)},${vp.y.toFixed(2)},${vp.width.toFixed(2)},${vp.height.toFixed(2)}|${vp.tileW.toFixed(3)},${vp.tileH.toFixed(3)}|${vp.fontSizePx.toFixed(2)}`;
                lastViewportLogKey = logKey;

                painterRef.set_dom_viewport({
                    x: vp.x,
                    y: vp.y,
                    width: vp.width,
                    height: vp.height,
                    tileW: vp.tileW,
                    tileH: vp.tileH,
                    fontSizePx: vp.fontSizePx,
                    offsetX: 0,
                    offsetY: 0
                });
                if (forceResync) {
                    logPainterViewportState('completed forced painter viewport resync', {
                        viewport: {
                            x: Math.round(vp.x),
                            y: Math.round(vp.y),
                            width: Math.round(vp.width),
                            height: Math.round(vp.height),
                        },
                    });
                }
            } else {
                logPainterViewportIssue('computed painter viewport unavailable', {
                    module_rect: rect,
                });
            }
        } else if (!canvasModule) {
            logPainterViewportIssue('painter canvas module missing');
        } else {
            logPainterViewportIssue('painter tile metrics invalid', {
                module_rect: canvasModule.rect,
            });
        }

        if (forceResync) {
            forcePainterViewportResync = false;
        }

        if (boot_frames_left > 0) boot_frames_left -= 1;
        
        // Render DOM layers with updated viewport
        painterRef.render_dom_layers();
        
        // Render mono_canvas last (on top)
        originalTick();
    };
} else {
    const originalTick = (runtime as any)['tick'].bind(runtime);
    let tileSize = { w: 0, h: 0 };
    let globalPan = { x: 0, y: 0 };
    let uiScale = 1.0;
    let gotPanEvent = false;
    let boot_frames_left = 10;
    let forcePlaceViewportResync = false;

    function computeTileMetrics(scale: number): { tileW: number; tileH: number; fontSizePx: number } | null {
        const metrics = get_ui_cell_metrics(scale, config.base_font_size_px);
        return {
            tileW: metrics.cell_w_px,
            tileH: metrics.cell_h_px,
            fontSizePx: metrics.font_size_px,
        };
    }

    window.addEventListener('thaumworld_ui_pan', ((ev: CustomEvent) => {
        tileSize.w = ev.detail?.tile_w_px ?? 0;
        tileSize.h = ev.detail?.tile_h_px ?? 0;
        globalPan.x = ev.detail?.pan_x_px ?? 0;
        globalPan.y = ev.detail?.pan_y_px ?? 0;
        uiScale = ev.detail?.scale ?? uiScale;
        gotPanEvent = true;
    }) as EventListener);

    try {
        const markPlaceViewportResyncNeeded = () => {
            forcePlaceViewportResync = true;
            gotPanEvent = false;
        };
        window.addEventListener('focus', markPlaceViewportResyncNeeded);
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                markPlaceViewportResyncNeeded();
            }
        });
        window.addEventListener('resize', markPlaceViewportResyncNeeded);
    } catch {
        // ignore
    }

    (runtime as any)['tick'] = () => {
        const currentModules: readonly Module[] = module_registry?.get_all ? module_registry.get_all() : modules;
        const placeModule = currentModules.find(m => m.id === 'place') as any;
        const bootWarmup = boot_frames_left > 0;
        const forceResync = forcePlaceViewportResync;

        if (tileSize.w <= 0 || tileSize.h <= 0 || bootWarmup || forceResync) {
            const metrics = computeTileMetrics(runtime.get_scale());
            if (metrics) {
                tileSize.w = metrics.tileW;
                tileSize.h = metrics.tileH;
                uiScale = runtime.get_scale();
            }
        }

        if (!gotPanEvent || bootWarmup || forceResync) {
            const r = canvasEl.getBoundingClientRect();
            if (Number.isFinite(r.left) && Number.isFinite(r.top)) {
                globalPan.x = r.left;
                globalPan.y = r.top;
            }
        }

        if (forceResync && typeof placeModule?.force_dom_resync === 'function') {
            placeModule.force_dom_resync('main_runtime_visibility_focus_resize_resync');
        }

        if (placeModule?.rect && typeof placeModule.set_dom_viewport === 'function' && tileSize.w > 0 && tileSize.h > 0) {
            const vp = compute_dom_viewport_for_rect({
                pan_x_px: globalPan.x,
                pan_y_px: globalPan.y,
                tile_w_px: tileSize.w,
                tile_h_px: tileSize.h,
                grid_height: config.grid_height,
                rect: placeModule.rect,
                base_font_size_px: config.base_font_size_px,
                ui_scale: uiScale,
            });
            placeModule.set_dom_viewport(vp ?? null);
        }

        if (forceResync) {
            forcePlaceViewportResync = false;
        }
        if (boot_frames_left > 0) boot_frames_left -= 1;

        originalTick();
    };
}

type TextureFilterEls = {
    disp_wobble: HTMLElement;
    disp_texture: HTMLElement;
    noise_wobble: HTMLElement;
    noise_texture: HTMLElement;
};

function get_texture_filter_els(): TextureFilterEls | null {
    const disp_wobble = document.getElementById('uiDispWobble');
    const disp_texture = document.getElementById('uiDispTexture');
    const noise_wobble = document.getElementById('uiNoiseWobble');
    const noise_texture = document.getElementById('uiNoiseTexture');
    if (!disp_wobble || !disp_texture || !noise_wobble || !noise_texture) return null;
    return { disp_wobble, disp_texture, noise_wobble, noise_texture };
}

function update_texture_filter_for_scale(scale: number): void {
    const els = get_texture_filter_els();
    if (!els) return;

    const s = Number.isFinite(scale) ? Math.max(0.25, Math.min(6.0, scale)) : 1.0;
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

    const wobble_scale = clamp(7.5 * s, 5.0, 24.0);
    const texture_scale = clamp(4.0 * s, 2.5, 18.0);
    const wobble_freq = clamp(0.0065 / s, 0.002, 0.02);
    const texture_freq = clamp(0.11 / s, 0.025, 0.22);

    try {
        els.disp_wobble.setAttribute('scale', wobble_scale.toFixed(2));
        els.disp_texture.setAttribute('scale', texture_scale.toFixed(2));
        els.noise_wobble.setAttribute('baseFrequency', wobble_freq.toFixed(4));
        els.noise_texture.setAttribute('baseFrequency', texture_freq.toFixed(4));
    } catch {
        // ignore
    }
}

function update_background_for_scale(scale: number): void {
    const s = clamp_ui_scale(scale);
    try {
        document.documentElement.style.setProperty('--ui-scale', String(s));
    } catch {
        // ignore
    }
}

function update_background_for_pan(pan_x_px: number, pan_y_px: number, tile_w_px: number, tile_h_px: number): void {
    if (!Number.isFinite(pan_x_px) || !Number.isFinite(pan_y_px)) return;
    if (!Number.isFinite(tile_w_px) || !Number.isFinite(tile_h_px)) return;
    try {
        document.documentElement.style.setProperty('--pan-x', `${pan_x_px.toFixed(2)}px`);
        document.documentElement.style.setProperty('--pan-y', `${pan_y_px.toFixed(2)}px`);
        document.documentElement.style.setProperty('--tile-w', `${tile_w_px.toFixed(2)}px`);
        document.documentElement.style.setProperty('--tile-h', `${tile_h_px.toFixed(2)}px`);
    } catch {
        // ignore
    }
}

function load_saved_ui_scale(): number {
    try {
        const raw = window.localStorage.getItem('thaumworld_ui_scale');
        if (!raw) return 1.0;
        const v = Number(raw);
        if (!Number.isFinite(v)) return 1.0;
        return clamp_ui_scale(v);
    } catch {
        return 1.0;
    }
}

async function boot() {
    const saved_scale = load_saved_ui_scale();
    if ((document as any).fonts?.load) {
        try {
            await (document as any).fonts.load(`${config.base_font_size_px * saved_scale}px "${config.font_family}"`);
            await (document as any).fonts.load(`${config.base_font_size_px * saved_scale}px "${get_theme_font_primary_family(THAUMWORLD_RENDER_THEME)}"`);
            await (document as any).fonts.ready;
        } catch {
            // best-effort
        }
    }

    runtime.set_scale(saved_scale);
    apply_responsive_layout(saved_scale);
    update_texture_filter_for_scale(saved_scale);
    update_background_for_scale(saved_scale);

    try {
        window.addEventListener('thaumworld_ui_scale', (ev: any) => {
            const next = Number(ev?.detail?.scale);
            if (!Number.isFinite(next)) return;
            apply_responsive_layout(next);
            update_texture_filter_for_scale(next);
            update_background_for_scale(next);
        });
    } catch {
        // ignore
    }

    // Background pan tracking (game mode only - in painter mode canvas doesn't move)
    if (!IS_PAINTER_MODE) {
        try {
            window.addEventListener('thaumworld_ui_pan', (ev: any) => {
                const pan_x_px = Number(ev?.detail?.pan_x_px);
                const pan_y_px = Number(ev?.detail?.pan_y_px);
                const tile_w_px = Number(ev?.detail?.tile_w_px);
                const tile_h_px = Number(ev?.detail?.tile_h_px);
                update_background_for_pan(pan_x_px, pan_y_px, tile_w_px, tile_h_px);
            });
        } catch {
            // ignore
        }
    }

    try {
        window.addEventListener('resize', () => {
            apply_responsive_layout(runtime.get_scale());
        });
    } catch {
        // ignore
    }

    runtime.start();

    // Texture deformation animation
    const wobble = document.getElementById('uiOffsetWobble');
    const texture = document.getElementById('uiOffsetTexture');
    if (wobble && texture) {
        let ui_scale = saved_scale;
        let wx = 0;
        let wy = 0;
        let tx = 0;
        let ty = 0;

        const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
        const step = (max_step: number) => (Math.random() * 2 - 1) * max_step;

        try {
            window.addEventListener('thaumworld_ui_scale', (ev: any) => {
                const next = Number(ev?.detail?.scale);
                if (Number.isFinite(next)) ui_scale = next;
            });
        } catch {
            // ignore
        }

        setInterval(() => {
            const s = Number.isFinite(ui_scale) ? Math.max(0.25, Math.min(6.0, ui_scale)) : 1.0;
            const wobble_bound = 9 * s;
            const texture_bound = 20 * s;

            wx = clamp(wx + step(0.6 * s), -wobble_bound, wobble_bound);
            wy = clamp(wy + step(1.2 * s), -wobble_bound, wobble_bound);
            tx = clamp(tx + step(1.4 * s), -texture_bound, texture_bound);
            ty = clamp(ty + step(1.4 * s), -texture_bound, texture_bound);

            try {
                wobble.setAttribute('dx', wx.toFixed(2));
                wobble.setAttribute('dy', wy.toFixed(2));
                texture.setAttribute('dx', tx.toFixed(2));
                texture.setAttribute('dy', ty.toFixed(2));
            } catch {
                // ignore
            }
        }, 1000 / 12);
    }
}

void boot();
