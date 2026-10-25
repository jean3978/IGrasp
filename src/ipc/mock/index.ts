// In-memory backend used in a plain browser (`npm run dev`), in unit tests and in the Playwright
// end-to-end tests. Tests drive it through `window.__igraspMock`.

import {
  DEFAULT_SETTINGS,
  MAX_FONT_SIZE,
  MAX_HISTORY_LIMIT,
  MIN_FONT_SIZE,
  MIN_HISTORY_LIMIT,
  applySettingsPatch,
} from '../defaults';
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
  ProfileCorrections,
  Settings,
} from '../types';
import { FIXTURE_FILES, FIXTURE_NAME, FIXTURE_ROOT, FIXTURE_SIZES, fixtureMtimes } from './fixture';
import { checkOpenable, readText } from './mockFiles';
import { backlinksOf, brokenCount, brokenDocs, buildGraph } from './mockGraph';
import type { MockDoc } from './mockGraph';
import { searchSymbols } from './mockSymbols';
import { buildRegExp, filterFiles, searchContent } from './mockText';
import { gitignorePatterns, isMarkdown, listFixtureDir, scanFixture } from './mockIndex';
import type { MockScanOptions } from './mockIndex';
import { DEFAULT_MOCK_AI, MOCK_PROVIDER_ID, createMockAi } from './mockAi';
import type { MockAiState } from './mockAi';
import {
  EMPTY_CORRECTIONS,
  applyCorrections,
  fixtureProfile,
  normalizeCorrections,
} from './mockProfile';
import { fixtureSubjects } from './mockSubjects';

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
  /** Document graph of the open root; null until "built" (after the index). */
  graph: Map<string, MockDoc> | null;
  /** Delay of the fake graph build after the index is ready, in milliseconds. */
  graphDelayMs: number;
  /** What the next folder picker returns (null = cancelled). */
  pickFolderResult: string | null;
  /** Files and URLs the app asked to open externally, in order. */
  opened: string[];
  /** Profile corrections by root path (app data of the learning features). */
  learning: Map<string, ProfileCorrections>;
  /** The mock AI provider: installed, logged in, speed, operations started. */
  ai: MockAiState;
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
  /** Delays the next graph builds (to test the "indexing headings and links" states). */
  setGraphDelay(ms: number): void;
}

declare global {
  interface Window {
    __igraspMock?: MockControls;
  }
}

function initialState(): MockState {
  return {
    // The mock is the only provider of the mock backend, like Claude in the real app.
    settings: {
      ...structuredClone(DEFAULT_SETTINGS),
      ai: { ...structuredClone(DEFAULT_SETTINGS.ai), provider: MOCK_PROVIDER_ID },
    },
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
    graph: null,
    graphDelayMs: 0,
    pickFolderResult: FIXTURE_ROOT,
    learning: new Map(),
    ai: { ...DEFAULT_MOCK_AI, starts: [], conversations: new Map() },
  };
}

function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

export function createMockBackend(): Backend & { controls: MockControls } {
  let state = initialState();
  let searchId = 0;
  const cancelled = new Set<number>();
  const handlers = new Map<EventName, Set<Handler>>();

  const emit: MockControls['emit'] = (event, payload) => {
    for (const h of handlers.get(event) ?? []) (h as (p: typeof payload) => void)(payload);
  };

  /** A file of the fake disk with its size and time, or undefined. */
  const fakeFile = (relPath: string) => {
    const content = state.files.get(relPath);
    if (content === undefined) return undefined;
    return {
      content,
      size: FIXTURE_SIZES[relPath] ?? content.length,
      modifiedMs: state.mtimes.get(relPath) ?? 0,
    };
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
    if (added.length + modified.length + removed.length === 0) {
      graphChanged([], []);
      return;
    }
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
    graphChanged(
      [...added, ...modified].map((f) => f.relPath),
      removed,
    );
  };

  /** Rebuilds the graph after a disk change and emits `graph://changed` like Rust. */
  const graphChanged = (touched: string[], removed: string[]) => {
    if (!state.graph || !state.index) return;
    const before = state.graph;
    const after = buildGraph(state.files, state.index.keys());
    state.graph = after;
    const docs = [...after.keys()].filter(
      (rel) =>
        touched.includes(rel) ||
        JSON.stringify(before.get(rel)?.links) !== JSON.stringify(after.get(rel)?.links),
    );
    if (docs.length === 0 && removed.length === 0) return;
    emit('graph://changed', {
      generation: state.generation,
      docs: docs.sort(),
      removed,
      brokenCount: brokenCount(after),
    });
  };

  const ai = createMockAi({
    emit,
    ai: () => state.ai,
    settings: () => state.settings,
    rootPath: () => state.root?.path ?? null,
    file: (relPath) => {
      const found = fakeFile(relPath);
      return found && { content: found.content, size: found.size };
    },
    fileContent: (relPath) => state.files.get(relPath),
    writeFiles: (files) => {
      controls.writeFiles(files);
    },
  });

  // Strictly increasing, so two writes in the same millisecond still count as a change.
  let clock = 0;
  const tick = () => (clock = Math.max(clock + 1, Date.now()));
  const controls: MockControls = {
    emit,
    get state() {
      return state;
    },
    reset() {
      ai.reset();
      state = initialState();
    },
    writeFiles(files) {
      for (const [rel, content] of Object.entries(files)) {
        state.files.set(rel, content);
        state.mtimes.set(rel, tick());
      }
      diskChanged();
    },
    setGraphDelay(ms) {
      state.graphDelayMs = ms;
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
      startGraphBuild(generation);
    }, state.scanDelayMs);
  };

  const startGraphBuild = (generation: number) => {
    state.graph = null;
    setTimeout(() => {
      if (state.generation !== generation || !state.index) return;
      state.graph = buildGraph(state.files, state.index.keys());
      const links = [...state.graph.values()].reduce((n, d) => n + d.links.length, 0);
      emit('graph://ready', {
        generation,
        docs: state.graph.size,
        links,
        brokenCount: brokenCount(state.graph),
        elapsedMs: 1,
        skipped: 0,
      });
    }, state.graphDelayMs);
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
      state.graph = null;
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

    // Async so the errors thrown by the helpers become rejections.
    // eslint-disable-next-line @typescript-eslint/require-await
    readTextFile: async (relPath) => {
      if (!state.root) throw new BackendError('NoRootOpen', 'No folder is open.');
      return readText(relPath, fakeFile(relPath));
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    openWithDefaultApp: async (relPath) => {
      if (!state.root) throw new BackendError('NoRootOpen', 'No folder is open.');
      checkOpenable(relPath, fakeFile(relPath));
      state.opened.push(`editor:${relPath}`);
    },
    revealInFileManager: (relPath) => {
      if (!state.root) return Promise.reject(new BackendError('NoRootOpen', 'No folder is open.'));
      const isDir = [...state.files.keys()].some((k) => k.startsWith(`${relPath}/`));
      if (relPath !== '' && !state.files.has(relPath) && !isDir) {
        return Promise.reject(new BackendError('NotFound', `Not found: ${relPath}`));
      }
      state.opened.push(`reveal:${relPath}`);
      return Promise.resolve();
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

    getGraphStatus: () => {
      if (!state.root) return Promise.reject(new BackendError('NoRootOpen', 'No folder is open.'));
      const graph = state.graph;
      return Promise.resolve({
        generation: state.generation,
        ready: graph !== null,
        parsedDocs: graph?.size ?? 0,
        totalDocs: state.index?.size ?? 0,
        brokenCount: graph ? brokenCount(graph) : 0,
      });
    },

    getDocLinks: (relPath) => {
      if (!state.root) return Promise.reject(new BackendError('NoRootOpen', 'No folder is open.'));
      return Promise.resolve({
        relPath,
        graphReady: state.graph !== null,
        links: structuredClone(state.graph?.get(relPath)?.links ?? []),
      });
    },
    getBacklinks: (relPath) => {
      if (!state.root) return Promise.reject(new BackendError('NoRootOpen', 'No folder is open.'));
      return Promise.resolve({
        relPath,
        graphReady: state.graph !== null,
        items: state.graph ? backlinksOf(state.graph, relPath) : [],
      });
    },
    listBrokenLinks: () => {
      if (!state.root) return Promise.reject(new BackendError('NoRootOpen', 'No folder is open.'));
      const graph = state.graph;
      return Promise.resolve({
        generation: state.generation,
        graphReady: graph !== null,
        parsedDocs: graph?.size ?? 0,
        totalDocs: state.index?.size ?? 0,
        docs: graph ? structuredClone(brokenDocs(graph)) : [],
      });
    },
    // Async so the errors thrown by the helpers become rejections.
    // eslint-disable-next-line @typescript-eslint/require-await
    searchText: async (request) => {
      if (!state.root) throw new BackendError('NoRootOpen', 'No folder is open.');
      if (!state.index)
        throw new BackendError('IndexNotReady', 'The folder is still being indexed.');
      const re = buildRegExp(request);
      const files = filterFiles([...state.index.keys()], request);
      const id = (searchId += 1);
      cancelled.add(id - 1);
      const generation = state.generation;
      const max = request.maxResults ?? 20_000;
      const stats = { filesSearched: 0, filesMatched: 0, matches: 0, skipped: 0, elapsedMs: 0 };
      let truncated = false;
      // One file per tick, so a test or the UI can cancel in the middle like a real search.
      const step = (i: number) => {
        const isCancelled = cancelled.has(id);
        const file = files[i];
        if (isCancelled || file === undefined || truncated) {
          emit('search://results', {
            searchId: id,
            generation,
            files: [],
            done: true,
            cancelled: isCancelled,
            truncated: truncated && !isCancelled,
            stats,
          });
          return;
        }
        stats.filesSearched += 1;
        // Like Rust: one match more than the room left tells whether a match is left out, and
        // reaching a cap exactly is not truncation.
        const room = max - stats.matches;
        let matches = searchContent(re, state.files.get(file) ?? '', room + 1);
        if (matches.length > 0 && (room === 0 || stats.filesMatched >= 2000)) {
          truncated = true;
          matches = [];
        } else if (matches.length > room) {
          matches = matches.slice(0, room);
          truncated = true;
        }
        if (matches.length > 0) {
          stats.filesMatched += 1;
          stats.matches += matches.length;
          emit('search://results', {
            searchId: id,
            generation,
            files: [{ relPath: file, matches }],
            done: false,
            cancelled: false,
            truncated: false,
            stats: { ...stats },
          });
        }
        setTimeout(() => {
          step(i + 1);
        }, 0);
      };
      setTimeout(() => {
        step(0);
      }, 0);
      return id;
    },
    cancelSearch: (id) => {
      cancelled.add(id);
      return Promise.resolve();
    },

    searchSymbols: (request) => {
      if (!state.root) return Promise.reject(new BackendError('NoRootOpen', 'No folder is open.'));
      const files = [...(state.index?.keys() ?? [])];
      return Promise.resolve(searchSymbols(request, files, state.graph, state.generation));
    },

    getSettings: () => Promise.resolve(structuredClone(state.settings)),
    updateSettings: (patch) => {
      const next: Settings = applySettingsPatch(state.settings, patch);
      next.fontSize = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, next.fontSize));
      next.ignorePatterns = next.ignorePatterns
        .map((p) => p.trim())
        .filter((p) => p !== '' && !p.startsWith('#'));
      // Like `Settings::normalize` in Rust.
      next.ai.model = next.ai.model.trim();
      if (!/^[A-Za-z0-9.:/_][A-Za-z0-9.:/_-]*$/.test(next.ai.model)) next.ai.model = '';
      next.ai.historyLimit = Math.min(
        MAX_HISTORY_LIMIT,
        Math.max(MIN_HISTORY_LIMIT, next.ai.historyLimit),
      );
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
    aiStatus: ai.aiStatus,
    aiCapabilities: ai.aiCapabilities,
    aiProviders: ai.aiProviders,
    aiSetProvider: ai.aiSetProvider,
    aiContext: ai.aiContext,
    aiEstimate: ai.aiEstimate,
    aiStart: ai.aiStart,
    aiRespondPermission: ai.aiRespondPermission,
    aiCancel: ai.aiCancel,
    listConversations: ai.listConversations,
    getConversation: ai.getConversation,
    saveConversation: ai.saveConversation,
    deleteConversation: ai.deleteConversation,
    forgetConversations: ai.forgetConversations,

    getProjectProfile: () => {
      const root = state.root;
      if (!root) return Promise.reject(new BackendError('NoRootOpen', 'No folder is open.'));
      const corrections = state.learning.get(root.path) ?? EMPTY_CORRECTIONS;
      return Promise.resolve(applyCorrections(fixtureProfile(state.files, root.name), corrections));
    },
    setProfileCorrections: (corrections) => {
      const root = state.root;
      if (!root) return Promise.reject(new BackendError('NoRootOpen', 'No folder is open.'));
      const normalized = normalizeCorrections(corrections);
      state.learning.set(root.path, normalized);
      return Promise.resolve(applyCorrections(fixtureProfile(state.files, root.name), normalized));
    },
    listSubjects: () => {
      if (!state.root) return Promise.reject(new BackendError('NoRootOpen', 'No folder is open.'));
      return Promise.resolve(fixtureSubjects(state.files));
    },

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
