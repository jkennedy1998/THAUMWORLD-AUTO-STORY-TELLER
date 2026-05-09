import { make_floating_panel_module } from './floating_panel_module.js';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const module = make_floating_panel_module({
  id: 'test_panel',
  rect: { x0: 0, y0: 0, x1: 5, y1: 5 },
  draw_content: () => {},
});

assert(module.BringToFrontOnPointerDown === true, 'floating panels should request bring-to-front on pointer down');
console.log('floating_panel_module_front tests passed');
