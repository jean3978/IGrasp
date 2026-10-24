import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Set by `tauri dev` when running on a remote device (mobile); unused on desktop.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  // Keep Rust compiler output visible when running through `tauri dev`.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host ?? false,
    ...(host ? { hmr: { protocol: 'ws', host, port: 1421 } } : {}),
    watch: { ignored: ['**/src-tauri/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: {
    // WebView2 is evergreen Chromium; WebKitGTK 2.44+ matches Safari 17.4.
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari17',
    sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
  },
});
