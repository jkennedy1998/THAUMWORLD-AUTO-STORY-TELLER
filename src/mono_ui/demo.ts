import { create_canvas } from "./canvas.js";
import { debug_log } from "../shared/debug.js";
import { compose_modules } from "./compose.js";
import { make_fill_module } from "./modules/fill_module.js";

const c = create_canvas(20, 10);

const modules = [
    make_fill_module({
        id: "background",
        rect: { x0: 0, y0: 0, x1: 19, y1: 9 },
        char: ".",
    }),
    make_fill_module({
        id: "panel",
        rect: { x0: 5, y0: 2, x1: 14, y1: 7 },
        char: "#",
    }),
];

compose_modules(c, modules);

// console preview (top row printed first)
for (let y = c.height - 1; y >= 0; y--) {
    let row = "";
    for (let x = 0; x < c.width; x++) {
        row += c.get(x, y)?.char ?? " ";
    }
    debug_log(row);
}
