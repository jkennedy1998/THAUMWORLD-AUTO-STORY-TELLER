import { defineConfig } from 'vite';
import * as path from 'node:path';

export default defineConfig({
    root: path.resolve(__dirname, 'src/canvas_app'),
    server: { port: 5173 },
    build: {
        outDir: path.resolve(__dirname, 'dist_canvas'),
        emptyOutDir: true,
    },
});
