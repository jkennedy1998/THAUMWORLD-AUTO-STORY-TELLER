import type { Canvas, Module, PointerEvent, Rect } from '../types.js';
import { get_color_by_name } from '../colors.js';
import { make_floating_panel_module } from './floating_panel_module.js';

export type CanvasSettingsModuleOptions = {
  id: string;
  rect: Rect;
  is_visible: () => boolean;
  get_loop_breath_range: () => { start: number; end: number };
  get_file_breath_range: () => { start: number; end: number };
  get_content_breath_range?: () => { start: number; end: number } | null;
  get_frames_per_breath: () => number;
  get_loop_enabled: () => boolean;
  get_is_playing: () => boolean;
  on_step_loop_start: (delta: number) => void;
  on_step_loop_end: (delta: number) => void;
  on_step_frames_per_breath: (delta: number) => void;
  on_toggle_loop: () => void;
  on_toggle_playback: () => void;
  on_jump_to_start: () => void;
  on_jump_to_end: () => void;
  on_fit_to_content: () => void;
  on_close: () => void;
  on_move: (new_rect: Rect) => void;
};

type HitAction =
  | 'loop_start_dec'
  | 'loop_start_inc'
  | 'loop_end_dec'
  | 'loop_end_inc'
  | 'frames_dec'
  | 'frames_inc'
  | 'toggle_loop'
  | 'toggle_playback'
  | 'jump_start'
  | 'jump_end'
  | 'fit_content';

export function makeCanvasSettingsModule(opts: CanvasSettingsModuleOptions): Module {
  let hitboxes: Array<{ action: HitAction; x0: number; y0: number; x1: number; y1: number }> = [];
  const labelColor = get_color_by_name('off_white').rgb;
  const valueColor = get_color_by_name('vivid_yellow').rgb;
  const accentColor = get_color_by_name('vivid_cyan').rgb;
  const borderColor = get_color_by_name('vivid_yellow').rgb;

  function set_hitbox(action: HitAction, x0: number, y0: number, x1: number, y1: number): void {
    hitboxes.push({ action, x0, y0, x1, y1 });
  }

  function find_hitbox(x: number, y: number): HitAction | null {
    for (let i = hitboxes.length - 1; i >= 0; i -= 1) {
      const hit = hitboxes[i]!;
      if (x >= hit.x0 && x <= hit.x1 && y >= hit.y0 && y <= hit.y1) return hit.action;
    }
    return null;
  }

  function draw_text(c: Canvas, x: number, y: number, text: string, rgb = labelColor): void {
    for (let i = 0; i < text.length; i += 1) {
      c.set(x + i, y, { char: text[i]!, rgb, weight_index: 1, render_index: 10 });
    }
  }

  function draw_button(c: Canvas, x: number, y: number, label: string, action: HitAction, rgb = accentColor): void {
    const text = `[${label}]`;
    draw_text(c, x, y, text, rgb);
    set_hitbox(action, x, y, x + text.length - 1, y);
  }

  return make_floating_panel_module({
    id: opts.id,
    rect: opts.rect,
    title: () => 'TIMING',
    is_visible: opts.is_visible,
    background: { rgb: get_color_by_name('off_black').rgb },
    border: {
      border_rgb: borderColor,
      text_rgb: borderColor,
    },
    gizmos: {
      enabled: ['close', 'move', 'seamless'],
      can_close: true,
      can_move: true,
      can_save_position: false,
      on_close: opts.on_close,
      on_move: opts.on_move,
    },
    draw_content(c: Canvas, rect: Rect): void {
      hitboxes = [];
      const loopRange = opts.get_loop_breath_range();
      const fileRange = opts.get_file_breath_range();
      const contentRange = opts.get_content_breath_range?.() ?? null;
      const framesPerBreath = opts.get_frames_per_breath();
      const loopEnabled = opts.get_loop_enabled();
      const isPlaying = opts.get_is_playing();
      const rows = [rect.y1 - 2, rect.y1 - 4, rect.y1 - 6, rect.y1 - 8, rect.y1 - 10, rect.y1 - 12];
      draw_text(c, rect.x0 + 2, rows[0]!, `LOOP S ${loopRange.start}`, valueColor);
      draw_button(c, rect.x1 - 11, rows[0]!, '-', 'loop_start_dec');
      draw_button(c, rect.x1 - 7, rows[0]!, '+', 'loop_start_inc');
      draw_text(c, rect.x0 + 2, rows[1]!, `LOOP E ${loopRange.end}`, valueColor);
      draw_button(c, rect.x1 - 11, rows[1]!, '-', 'loop_end_dec');
      draw_button(c, rect.x1 - 7, rows[1]!, '+', 'loop_end_inc');
      draw_text(c, rect.x0 + 2, rows[2]!, `FPB ${framesPerBreath}`, valueColor);
      draw_button(c, rect.x1 - 11, rows[2]!, '-', 'frames_dec');
      draw_button(c, rect.x1 - 7, rows[2]!, '+', 'frames_inc');
      draw_button(c, rect.x0 + 2, rows[3]!, loopEnabled ? 'LOOP X' : 'LOOP  ', 'toggle_loop');
      draw_button(c, rect.x0 + 14, rows[3]!, isPlaying ? 'STOP' : 'PLAY', 'toggle_playback');
      draw_button(c, rect.x0 + 2, rows[4]!, 'JMP S', 'jump_start');
      draw_button(c, rect.x0 + 12, rows[4]!, 'JMP E', 'jump_end');
      draw_button(c, rect.x0 + 2, rows[5]!, 'FIT', 'fit_content');
      draw_text(c, rect.x0 + 10, rows[5]!, `FILE ${fileRange.start}..${fileRange.end}`, labelColor);
      if (contentRange) draw_text(c, rect.x0 + 10, rows[5]! - 1, `CNT ${contentRange.start}..${contentRange.end}`, labelColor);
    },
    on_pointer_down_content(e: PointerEvent): void {
      const action = find_hitbox(e.x, e.y);
      if (!action) return;
      if (action === 'loop_start_dec') opts.on_step_loop_start(-1);
      else if (action === 'loop_start_inc') opts.on_step_loop_start(1);
      else if (action === 'loop_end_dec') opts.on_step_loop_end(-1);
      else if (action === 'loop_end_inc') opts.on_step_loop_end(1);
      else if (action === 'frames_dec') opts.on_step_frames_per_breath(-1);
      else if (action === 'frames_inc') opts.on_step_frames_per_breath(1);
      else if (action === 'toggle_loop') opts.on_toggle_loop();
      else if (action === 'toggle_playback') opts.on_toggle_playback();
      else if (action === 'jump_start') opts.on_jump_to_start();
      else if (action === 'jump_end') opts.on_jump_to_end();
      else if (action === 'fit_content') opts.on_fit_to_content();
    },
  });
}
