// Selects the backend once at startup: real Tauri IPC inside the app, the in-memory mock elsewhere
// (browser dev server, unit tests, Playwright). Everything else imports `backend` from here.

import { createMockBackend } from './mock';
import { tauriBackend } from './tauri';
import type { Backend } from './types';

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function select(): Backend {
  if (isTauri()) return tauriBackend;
  const mock = createMockBackend();
  if (typeof window !== 'undefined') window.__igraspMock = mock.controls;
  return mock;
}

export const backend: Backend = select();
