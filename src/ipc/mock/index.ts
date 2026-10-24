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
  FileEntry,
  RecentFolder,
  RenamedPath,
  RootInfo,
  Session,
  Settings,
} from '../types';
import { FIXTURE_FILES, FIXTURE_NAME, FIXTURE_ROOT, fixtureMtimes } from './fixture';
import { gitignorePatterns, isMarkdown, listFixtureDir, scanFixture } from './mockIndex';
import type { MockScanOptions } from './mockIndex';

type Handler = (payload: never) => void;

const BOM = String.fromCharCode(0xfeff);

export interface MockState {
  settings: Settings;
  recent: Omit<RecentFolder, 'exists'>[];
  sessions: Map<string, Session>;
  /** Folders that "exist" on the fake disk, by absolute path. */
  folders: Set<string>;
  /** Files of the fixture project, by root-relative path. */
  files: Map<string, string>;
  /** Modification times of the files (absent = 0). */
  mtimes: Map<string, number>;
  root: RootInfo | null;
  generation: number;
  /** Markdown index of the open root; null while "scanning". */
  index: Map<string, FileEntry> | null;
  scan: MockScanOptions;
  /** Delay of the fake scan, in milliseconds. */
  scanDelayMs: number;
  /** What the next folder picker returns (null = cancelled). */
  pickFolderResult: string | null;
  /** Files and URLs the app asked to open externally, in order. */
  opened: string[];
}

export interface MockControls {
  /** Pushes a backend event to the frontend as if Rust had emitted it. */
  emit<E extends EventName>(event: E, payload: BackendEvents[E]): void;
  state: MockState;
  reset(): void;
  /** Writes files on the fake disk and emits `fs://changes` like the Rust watcher. */
  writeFiles(files: Record<string, string>): void;
  deleteFiles(paths: string[]): void;
  renameFile(from: string, to: string): void;
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
    mtimes: fixtureMtimes(Date.now()),
    opened: [],
    root: null,
    generation: 0,
    index: null,
    scan: { showDotfiles: false, showIgnored: false, ignorePatterns: [] },
    scanDelayMs: 0,
    pickFolderResult: FIXTURE_ROOT,
  };
}

function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

export function createMockBackend(): Backend & { controls: MockControls } {
  let state = initialState();
  const handlers = new Map<EventName, Set<Handler>>();

  const emit: MockControls['emit'] = (event, payload) => {
    for (const h of handlers.get(event) ?? []) (h as (p: typeof payload) => void)(payload);
  };

  const indexFixture = () => {
    const index = scanFixture(state.files, state.scan, 0);
    for (const [rel, entry] of index) entry.modifiedMs = state.mtimes.get(rel) ?? 0;
    return index;
  };

  /** Re-indexes after a fake disk change and emits the difference as `fs://changes`. */
  const diskChanged = (renamed: RenamedPath[] = []) => {
    if (!state.root || !state.index) return;
    const before = state.index;
    const after = indexFixture();
    state.index = after;
    const added = [...after.values()].filter((f) => !before.has(f.relPath));
    const modified = [...after.values()].filter((f) => {
      const old = before.get(f.relPath);
      return old !== undefined && (old.modifiedMs !== f.modifiedMs || old.size !== f.size);
    });
    const removed = [...before.keys()].filter((rel) => !after.has(rel));
    if (added.length + modified.length + removed.length === 0) return;
    const dirs = new Set<string>();
    for (const rel of [...added.map((f) => f.relPath), ...removed]) {
      const parts = rel.split('/');
      for (let i = parts.length - 1; i >= 0; i--) dirs.add(parts.slice(0, i).join('/'));
    }
    emit('fs://changes', {
      generation: state.generation,
      added,
      modified,
      removed,
      renamed,
      dirsChanged: [...dirs].sort(),
    });
  };

  // Strictly increasing, so two writes in the same millisecond still count as a change.
  let clock = 0;
  const tick = () => (clock = Math.max(clock + 1, Date.now()));
  const controls: MockControls = {
    emit,
    get state() {
      return state;
    },
    reset() {
      state = initialState();
    },
    writeFiles(files) {
      for (const [rel, content] of Object.entries(files)) {
        state.files.set(rel, content);
        state.mtimes.set(rel, tick());
      }
      diskChanged();
    },
    deleteFiles(paths) {
      for (const rel of paths) state.files.delete(rel);
      diskChanged();
    },
    renameFile(from, to) {
      const content = state.files.get(from);
      if (content === undefined) return;
      state.files.delete(from);
      state.files.set(to, content);
      state.mtimes.set(to, state.mtimes.get(from) ?? 0);
      diskChanged([{ from, to }]);
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

  /** Starts a fake background scan of the fixture for the current generation. */
  const startScan = () => {
    const generation = state.generation;
    state.index = null;
    setTimeout(() => {
      if (state.generation !== generation || !state.root) return;
      controls.emit('index://progress', {
        generation,
        scannedEntries: state.files.size,
        markdownFiles: 0,
        elapsedMs: 1,
      });
      state.index = indexFixture();
      const dirs = new Set([...state.index.keys()].map((k) => k.split('/').slice(0, -1).join('/')));
      dirs.delete('');
      controls.emit('index://ready', {
        generation,
        markdownFiles: state.index.size,
        dirs: dirs.size,
        elapsedMs: 2,
        skipped: 0,
      });
    }, state.scanDelayMs);
  };

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
      const session = state.sessions.get(path);
      state.scan = {
        showDotfiles: session?.showDotfiles ?? state.settings.showDotfiles,
        showIgnored: session?.showIgnored ?? state.settings.showIgnored,
        ignorePatterns: state.settings.ignorePatterns,
      };
      state.root = {
        path,
        name,
        isGitRepo: true,
        generation: state.generation,
        showDotfiles: state.scan.showDotfiles,
        showIgnored: state.scan.showIgnored,
      };
      state.recent = [
        { path, name, lastOpenedMs: Date.now() },
        ...state.recent.filter((r) => r.path !== path),
      ].slice(0, 10);
      startScan();
      return Promise.resolve({ ...state.root });
    },
    closeRoot: () => {
      state.root = null;
      state.index = null;
      return Promise.resolve();
    },
    rescan: (request) => {
      if (!state.root) return Promise.reject(new BackendError('NoRootOpen', 'No folder is open.'));
      state.generation += 1;
      state.scan = {
        showDotfiles: request.showDotfiles ?? state.scan.showDotfiles,
        showIgnored: request.showIgnored ?? state.scan.showIgnored,
        ignorePatterns: state.settings.ignorePatterns,
      };
      startScan();
      return Promise.resolve(state.generation);
    },
    listDir: (relPath) => {
      if (!state.root) return Promise.reject(new BackendError('NoRootOpen', 'No folder is open.'));
      if (!state.index) {
        return Promise.reject(
          new BackendError('IndexNotReady', 'The folder is still being indexed.'),
        );
      }
      const listing = listFixtureDir(
        state.index,
        relPath,
        state.scan.showIgnored ? gitignorePatterns(state.files) : [],
      );
      if (!listing) return Promise.reject(new BackendError('NotFound', `Not found: ${relPath}`));
      return Promise.resolve({
        relPath,
        generation: state.generation,
        ...structuredClone(listing),
      });
    },
    listRecentFiles: (offset, limit) => {
      if (!state.root) return Promise.reject(new BackendError('NoRootOpen', 'No folder is open.'));
      if (!state.index) {
        return Promise.reject(
          new BackendError('IndexNotReady', 'The folder is still being indexed.'),
        );
      }
      const sorted = [...state.index.values()].sort(
        (a, b) => b.modifiedMs - a.modifiedMs || (a.relPath < b.relPath ? -1 : 1),
      );
      return Promise.resolve({
        generation: state.generation,
        total: sorted.length,
        files: structuredClone(sorted.slice(offset, offset + Math.min(limit, 5000))),
      });
    },
    readMarkdown: (relPath) => {
      if (!state.root) return Promise.reject(new BackendError('NoRootOpen', 'No folder is open.'));
      const content = state.files.get(relPath);
      if (content === undefined || !isMarkdown(relPath)) {
        return Promise.reject(new BackendError('NotFound', `Not found: ${relPath}`));
      }
      return Promise.resolve({
        relPath,
        content: content.startsWith(BOM) ? content.slice(1) : content,
        size: content.length,
        modifiedMs: state.mtimes.get(relPath) ?? 0,
      });
    },

    assetUrl: (_rootPath, relPath) => {
      const content = state.files.get(relPath);
      // Only SVG fixtures have real content; anything else fails to load, like a broken file.
      if (content?.trimStart().startsWith('<svg')) {
        return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(content)}`;
      }
      return `data:application/octet-stream,missing-${encodeURIComponent(relPath)}`;
    },
    openExternal: (relPath) => {
      state.opened.push(relPath);
      return Promise.resolve();
    },
    openUrl: (url) => {
      state.opened.push(url);
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
    openAppDataDir: () => {
      state.opened.push(appInfo.appDataDir);
      return Promise.resolve();
    },

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
