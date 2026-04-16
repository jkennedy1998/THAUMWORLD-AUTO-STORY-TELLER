export type ElectronInputHost = {
  attach(): void;
  detach(): void;
  readonly source_kind: 'dom_window' | 'electron_bridge';
};

export type ElectronInputHostOptions = {
  on_keydown: (ev: KeyboardEvent) => void;
  on_keyup: (ev: KeyboardEvent) => void;
  on_window_focus?: () => void;
  on_window_blur?: () => void;
};

export function create_electron_input_host(opts: ElectronInputHostOptions): ElectronInputHost {
  let attached = false;
  const source_kind = (window as any).electronAPI?.inputHostKind === 'electron_bridge' ? 'electron_bridge' : 'dom_window';
  const keydown = (ev: KeyboardEvent) => opts.on_keydown(ev);
  const keyup = (ev: KeyboardEvent) => opts.on_keyup(ev);
  const focus = () => opts.on_window_focus?.();
  const blur = () => opts.on_window_blur?.();

  return {
    source_kind,
    attach(): void {
      if (attached) return;
      attached = true;
      window.addEventListener('keydown', keydown);
      window.addEventListener('keyup', keyup);
      window.addEventListener('focus', focus);
      window.addEventListener('blur', blur);
    },
    detach(): void {
      if (!attached) return;
      attached = false;
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('focus', focus);
      window.removeEventListener('blur', blur);
    },
  };
}
