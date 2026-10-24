// In-memory backend used in a plain browser (`npm run dev`), in unit tests and in the Playwright
// end-to-end tests. Tests drive it through `window.__igraspMock`.

import { DEFAULT_SETTINGS, MAX_FONT_SIZE, MIN_FONT_SIZE } from '../defaults';
import type {
  AppInfo,
  Backend,
  BackendEvents,
  EventName,
  RecentFolder,
  Session,
  Settings,
} from '../types';

type Handler = (payload: never) => void;

export interface MockState {
  settings: Settings;
  recent: RecentFolder[];
  sessions: Map<string, Session>;
}

export interface MockControls {
  /** Pushes a backend event to the frontend as if Rust had emitted it. */
  emit<E extends EventName>(event: E, payload: BackendEvents[E]): void;
  state: MockState;
  reset(): void;
}

declare global {
  interface Window {
    __igraspMock?: MockControls;
  }
}

function initialState(): MockState {
  return {
    settings: structuredClone(DEFAULT_SETTINGS),
    recent: [],
    sessions: new Map(),
  };
}

export function createMockBackend(): Backend & { controls: MockControls } {
  let state = initialState();
  const handlers = new Map<EventName, Set<Handler>>();

  const controls: MockControls = {
    emit(event, payload) {
      for (const h of handlers.get(event) ?? []) (h as (p: typeof payload) => void)(payload);
    },
    get state() {
      return state;
    },
    reset() {
      state = initialState();
    },
  };

  const appInfo: AppInfo = {
    version: '0.0.0-mock',
    tauriVersion: 'mock',
    os: 'browser',
    appDataDir: '/mock/app-data',
    logDir: '/mock/app-data/logs',
  };

  return {
    controls,
    getSettings: () => Promise.resolve(structuredClone(state.settings)),
    updateSettings: (patch) => {
      const next: Settings = { ...state.settings, ...patch };
      next.fontSize = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, next.fontSize));
      next.ignorePatterns = next.ignorePatterns
        .map((p) => p.trim())
        .filter((p) => p !== '' && !p.startsWith('#'));
      state.settings = next;
      return Promise.resolve(structuredClone(next));
    },
    getRecentFolders: () => Promise.resolve(structuredClone(state.recent)),
    removeRecentFolder: (path) => {
      state.recent = state.recent.filter((r) => r.path !== path);
      return Promise.resolve(structuredClone(state.recent));
    },
    clearRecentFolders: () => {
      state.recent = [];
      return Promise.resolve([]);
    },
    getSession: (rootPath) =>
      Promise.resolve(structuredClone(state.sessions.get(rootPath) ?? null)),
    saveSession: (rootPath, session) => {
      state.sessions.set(rootPath, { ...structuredClone(session), savedAtMs: Date.now() });
      return Promise.resolve();
    },
    getAppInfo: () => Promise.resolve(appInfo),

    listen(event, handler) {
      let set = handlers.get(event);
      if (!set) {
        set = new Set();
        handlers.set(event, set);
      }
      set.add(handler);
      return Promise.resolve(() => {
        set.delete(handler);
      });
    },
  };
}
