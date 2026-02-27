import { defineConfig } from 'vite';
import * as path from 'node:path';
export default defineConfig({
    root: path.resolve(__dirname, 'src/ascii_painter_app'),
    server: {
        port: 5174, // Different port from game (5173)
        strictPort: true // Fail if port is taken
    },
    build: {
        outDir: path.resolve(__dirname, 'dist_ascii_painter'),
        emptyOutDir: true,
    },
});
//# sourceMappingURL=vite.painter.config.js.map