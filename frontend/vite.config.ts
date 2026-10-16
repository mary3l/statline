import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, searchForWorkspaceRoot } from 'vite';

// The recorders run the backend's own stats engine (pure TypeScript, no Node APIs), so live numbers match the box score.
const engine = fileURLToPath(new URL('../backend/src/engine', import.meta.url));

// In development the API runs on :3001 and Vite proxies /api to it, so the session cookie stays same-origin.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@engine': engine } },
  server: {
    port: 5173,
    strictPort: true,
    fs: { allow: [searchForWorkspaceRoot(process.cwd()), engine] },
    proxy: {
      // STATLINE_API points the proxy at another API (e.g. a second backend on its own database).
      '/api': { target: process.env.STATLINE_API ?? 'http://127.0.0.1:3001', changeOrigin: false },
    },
  },
});
