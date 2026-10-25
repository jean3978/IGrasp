import { create } from 'zustand';
import { useDocuments } from './documents';
import { useGraph } from './graph';
import { useOutline } from './outline';
import { useTextFiles } from './textFiles';

export type TabKind = 'document' | 'code' | 'settings' | 'shortcuts' | 'quiz';
export type FileTabKind = 'document' | 'code';
export type SpecialTabKind = Exclude<TabKind, FileTabKind>;

/** Where a tab should scroll once its content is rendered (consumed by the tab). */
export interface PendingScroll {
  /** Heading id without the `user-content-` prefix (documents). */
  anchor?: string;
  /** 1-based source line; with `endLine`, a range (code viewer `#L10-L20`). */
  line?: number;
  endLine?: number;
  /** Text to highlight around the line (search matches). */
  highlight?: string[];
}

export interface Tab {
  id: string;
  kind: TabKind;
  /** Root-relative path, for document and code tabs. */
  relPath: string | null;
  /** A preview tab (italic) is replaced by the next single-click open. */
  pinned: boolean;
  scrollTop: number;
  /** The file was deleted on disk while open. */
  deleted: boolean;
  pending?: PendingScroll | undefined;
}

export interface OpenOptions {
  pin?: boolean;
  scroll?: PendingScroll;
}

interface TabsState {
  tabs: Tab[];
  activeId: string | null;

  openDocument: (relPath: string, options?: OpenOptions) => void;
  /** Opens a non-markdown file in the read-only code viewer. */
  openCode: (relPath: string, options?: OpenOptions) => void;
  openSpecial: (kind: SpecialTabKind) => void;
  /** Returns and forgets the pending scroll target of a tab. */
  takePending: (id: string) => PendingScroll | undefined;
  pin: (id: string) => void;
  close: (id: string) => void;
  closeOthers: (id: string) => void;
  closeAll: () => void;
  activate: (id: string) => void;
  /** Activates the next (+1) or previous (-1) tab, wrapping around. */
  cycle: (delta: 1 | -1) => void;
  /** Activates the tab at a 1-based position; 9 always means the last tab (like browsers). */
  activateIndex: (position: number) => void;
  move: (id: string, delta: 1 | -1) => void;
  setScroll: (id: string, scrollTop: number) => void;
  markDeleted: (relPath: string, deleted: boolean) => void;
  renamePath: (from: string, to: string) => void;
  /** Replaces all tabs, e.g. when a session is restored. */
  restore: (tabs: Tab[], activeId: string | null) => void;
}

let nextId = 1;
export const newTabId = () => `tab-${String(nextId++)}`;

export const fileName = (relPath: string) => relPath.slice(relPath.lastIndexOf('/') + 1);

const SPECIAL_IDS: Record<SpecialTabKind, string> = {
  settings: 'tab-settings',
  shortcuts: 'tab-shortcuts',
  quiz: 'tab-quiz',
};

export const isFileTab = (tab: Tab): boolean => tab.kind === 'document' || tab.kind === 'code';

const pathsOf = (tabs: Tab[], kind: FileTabKind) =>
  new Set(tabs.filter((t) => t.kind === kind && t.relPath !== null).map((t) => t.relPath ?? ''));

/** Drops cached file contents that no tab shows anymore. */
function evictUnused(tabs: Tab[]) {
  useDocuments.getState().retain(pathsOf(tabs, 'document'));
  useTextFiles.getState().retain(pathsOf(tabs, 'code'));
  useGraph.getState().retainDocs(pathsOf(tabs, 'document'));
  useOutline.getState().retain(pathsOf(tabs, 'document'));
}

function loadContent(kind: FileTabKind, relPath: string) {
  if (kind === 'document') void useDocuments.getState().load(relPath);
  else void useTextFiles.getState().load(relPath);
}

export const useTabs = create<TabsState>()((set, get) => {
  /** Opens a file tab: reuses its tab, else takes the preview slot (documents and code share it). */
  const openFile = (kind: FileTabKind, relPath: string, options: OpenOptions) => {
    const pin = options.pin ?? false;
    const { tabs, activeId } = get();
    const existing = tabs.find((t) => t.kind === kind && t.relPath === relPath);
    if (existing) {
      set({
        activeId: existing.id,
        tabs: tabs.map((t) =>
          t.id === existing.id
            ? { ...t, pinned: t.pinned || pin, pending: options.scroll ?? t.pending }
            : t,
        ),
      });
      loadContent(kind, relPath);
      return;
    }

    const tab: Tab = {
      id: newTabId(),
      kind,
      relPath,
      pinned: pin,
      scrollTop: 0,
      deleted: false,
      pending: options.scroll,
    };
    const previewIndex = tabs.findIndex((t) => isFileTab(t) && !t.pinned);
    let next: Tab[];
    if (previewIndex >= 0) {
      // Reuse the preview tab's slot; a pinned open still replaces the preview (VS Code).
      next = tabs.map((t, i) => (i === previewIndex ? tab : t));
    } else {
      const activeIndex = tabs.findIndex((t) => t.id === activeId);
      next = [...tabs];
      next.splice(activeIndex + 1, 0, tab);
    }
    set({ tabs: next, activeId: tab.id });
    evictUnused(next);
    loadContent(kind, relPath);
  };

  return {
    tabs: [],
    activeId: null,

    openDocument(relPath, options = {}) {
      openFile('document', relPath, options);
    },

    openCode(relPath, options = {}) {
      openFile('code', relPath, options);
    },

    takePending(id) {
      const tab = get().tabs.find((t) => t.id === id);
      if (!tab?.pending) return undefined;
      const { pending } = tab;
      set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, pending: undefined } : t)) }));
      return pending;
    },

    openSpecial(kind) {
      const id = SPECIAL_IDS[kind];
      const { tabs, activeId } = get();
      if (tabs.some((t) => t.id === id)) {
        set({ activeId: id });
        return;
      }
      const tab: Tab = { id, kind, relPath: null, pinned: true, scrollTop: 0, deleted: false };
      const next = [...tabs];
      next.splice(tabs.findIndex((t) => t.id === activeId) + 1, 0, tab);
      set({ tabs: next, activeId: id });
    },

    pin(id) {
      set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, pinned: true } : t)) }));
    },

    close(id) {
      const { tabs, activeId } = get();
      const index = tabs.findIndex((t) => t.id === id);
      if (index < 0) return;
      const next = tabs.filter((t) => t.id !== id);
      let nextActive = activeId;
      if (activeId === id) {
        // Activate the tab that slides into this position, else the one before it.
        nextActive = (next[index] ?? next[index - 1])?.id ?? null;
      }
      set({ tabs: next, activeId: nextActive });
      evictUnused(next);
    },

    closeOthers(id) {
      const next = get().tabs.filter((t) => t.id === id);
      set({ tabs: next, activeId: next[0]?.id ?? null });
      evictUnused(next);
    },

    closeAll() {
      set({ tabs: [], activeId: null });
      evictUnused([]);
    },

    activate(id) {
      if (get().tabs.some((t) => t.id === id)) set({ activeId: id });
    },

    cycle(delta) {
      const { tabs, activeId } = get();
      if (tabs.length === 0) return;
      const index = tabs.findIndex((t) => t.id === activeId);
      const next = tabs[(index + delta + tabs.length) % tabs.length];
      if (next) set({ activeId: next.id });
    },

    activateIndex(position) {
      const { tabs } = get();
      const tab = position >= 9 ? tabs[tabs.length - 1] : tabs[position - 1];
      if (tab) set({ activeId: tab.id });
    },

    move(id, delta) {
      const tabs = [...get().tabs];
      const index = tabs.findIndex((t) => t.id === id);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= tabs.length) return;
      const [tab] = tabs.splice(index, 1);
      if (tab) tabs.splice(target, 0, tab);
      set({ tabs });
    },

    setScroll(id, scrollTop) {
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === id && t.scrollTop !== scrollTop ? { ...t, scrollTop } : t,
        ),
      }));
    },

    markDeleted(relPath, deleted) {
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.relPath === relPath && t.deleted !== deleted ? { ...t, deleted } : t,
        ),
      }));
    },

    renamePath(from, to) {
      set((s) => ({
        tabs: s.tabs.map((t) => (t.relPath === from ? { ...t, relPath: to, deleted: false } : t)),
      }));
    },

    restore(tabs, activeId) {
      set({
        tabs,
        activeId: tabs.some((t) => t.id === activeId) ? activeId : (tabs[0]?.id ?? null),
      });
      evictUnused(tabs);
    },
  };
});

export const selectActiveTab = (s: TabsState): Tab | undefined =>
  s.tabs.find((t) => t.id === s.activeId);

/** Title of a tab, with the parent folder added when several open files share a name. */
export function tabLabel(tab: Tab, tabs: Tab[]): { title: string; description: string | null } {
  if (tab.kind === 'settings') return { title: 'Settings', description: null };
  if (tab.kind === 'shortcuts') return { title: 'Keyboard Shortcuts', description: null };
  if (tab.kind === 'quiz') return { title: 'Quiz', description: null };
  const path = tab.relPath ?? '';
  const title = fileName(path);
  const clash = tabs.some(
    (t) => t.id !== tab.id && t.relPath !== null && fileName(t.relPath) === title,
  );
  if (!clash) return { title, description: null };
  const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '.';
  return { title, description: parent };
}

const isMarkdownPath = (path: string) => /\.(?:md|markdown)$/i.test(path);

/**
 * Opens a file of the folder where it reads best: a markdown file in the preview, scrolled to
 * the block of `line`; anything else in the code viewer with the range highlighted.
 */
export function openSourceFile(relPath: string, firstLine?: number, lastLine?: number): void {
  const tabs = useTabs.getState();
  if (isMarkdownPath(relPath)) {
    tabs.openDocument(relPath, firstLine === undefined ? {} : { scroll: { line: firstLine } });
  } else if (firstLine === undefined) {
    tabs.openCode(relPath);
  } else {
    tabs.openCode(relPath, { scroll: { line: firstLine, endLine: lastLine ?? firstLine } });
  }
}
