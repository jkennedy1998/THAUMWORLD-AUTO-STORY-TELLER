export type ViewportPanState = {
  offset_tiles_x: number;
  offset_tiles_y: number;
};

export interface IViewportPanRuntime {
  getState(): ViewportPanState;
  setOffset(x: number, y: number): void;
  panBy(dx: number, dy: number): void;
}

export function create_viewport_pan_runtime(initial?: Partial<ViewportPanState>): IViewportPanRuntime {
  const state: ViewportPanState = {
    offset_tiles_x: Math.floor(initial?.offset_tiles_x ?? 0),
    offset_tiles_y: Math.floor(initial?.offset_tiles_y ?? 0),
  };

  return {
    getState() {
      return { ...state };
    },
    setOffset(x: number, y: number) {
      state.offset_tiles_x = Math.floor(x);
      state.offset_tiles_y = Math.floor(y);
    },
    panBy(dx: number, dy: number) {
      state.offset_tiles_x += Math.floor(dx);
      state.offset_tiles_y += Math.floor(dy);
    },
  };
}
