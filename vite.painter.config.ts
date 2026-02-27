import { defineConfig } from 'vite';
import * as path from 'node:path';

export default defineConfig({
    root: path.resolve(__dirname, 'src/canvas_app'),
    server: { 
        port: 5174,  // Painter port (game uses 5173)
        strictPort: true  // Fail if port is taken
    },
    build: {
        outDir: path.resolve(__dirname, 'dist_ascii_painter'),
        emptyOutDir: true,
    },
});
