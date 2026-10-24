// In-memory backend used in a plain browser (`npm run dev`), in unit tests and in the Playwright
// end-to-end tests. Tests drive it through `window.__igraspMock`.

import { DEFAULT_SETTINGS, MAX_FONT_SIZE, MIN_FONT_SIZE } from '../defaults';
import { BackendError } from '../types';
import type {
  AppInfo,
  AppWindow,
  Backend,
  BackendEvents,
  EventName,
  RecentFolder,
  RootInfo,
  Session,
  Settings,
} from '../types';
import { FIXTURE_FILES, FIXTURE_NAME, FIXTURE_ROOT } from './fixture';

type Handler = (payload: never) => void;

export interface MockState {
  settings: Settings;
  recent: Omit<RecentFolder, 'exists'>[];
  sessions: Map<string, Session>;
  /** Folders that "exist" on the fake disk, by absolute path. */
  folders: Set<string>;
  /** Files of the fixture project, by root-relative path. */
  files: Map<string, string>;
  root: RootInfo | null;
  generation: number;
  /** What the next folder picker returns (null = cancelled). */
  pickFolderResult: string | null;
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
    folders: new Set([FIXTURE_ROOT]),
    files: new Map(Object.entries(FIXTURE_FILES)),
    root: null,
    generation: 0,
    pickFolderResult: FIXTURE_ROOT,
  };
}

function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
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

  const noop = () => Promise.resolve();
  const noopListener = () => Promise.resolve(() => undefined);
  const appWindow: AppWindow = {
    show: noop,
    minimize: noop,
    toggleMaximize: noop,
    close: noop,
    destroy: noop,
    isMaximized: () => Promise.resolve(false),
    startResizeDragging: noop,
    setDecorations: noop,
    setTitle: (title) => {
      document.title = title;
      return Promise.resolve();
    },
    onResized: noopListener,
    onFocusChanged: noopListener,
    onThemeChanged: noopListener,
    onCloseRequested: noopListener,
  };

  const recentList = (): RecentFolder[] =>
    state.recent.map((r) => ({ ...r, exists: state.folders.has(r.path) }));

  return {
    controls,
    window: appWindow,

    pickFolder: () => Promise.resolve(state.pickFolderResult),
    openRoot: (path) => {
      if (!state.folders.has(path)) {
        return Promise.reject(new BackendError('NotFound', `Not found: ${path}`));
      }
      state.generation += 1;
      const name = path === FIXTURE_ROOT ? FIXTURE_NAME : baseName(path);
      state.root = { path, name, isGitRepo: true, generation: state.generation };
      state.recent = [
        { path, name, lastOpenedMs: Date.now() },
        ...state.recent.filter((r) => r.path !== path),
      ].slice(0, 10);
      return Promise.resolve({ ...state.root });
    },
    closeRoot: () => {
      state.root = null;
      return Promise.resolve();
    },

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
    getRecentFolders: () => Promise.resolve(recentList()),
    removeRecentFolder: (path) => {
      state.recent = state.recent.filter((r) => r.path !== path);
      return Promise.resolve(recentList());
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
