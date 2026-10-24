// The contract between the frontend and a backend implementation (real Tauri or in-memory mock).
// Types under ./generated are exported from Rust by ts-rs; never edit them by hand.

import type { AppInfo } from './generated/AppInfo';
import type { DirEntry } from './generated/DirEntry';
import type { DirListing } from './generated/DirListing';
import type { ErrorCode } from './generated/ErrorCode';
import type { FileContent } from './generated/FileContent';
import type { FileEntry } from './generated/FileEntry';
import type { FsChangesEvent } from './generated/FsChangesEvent';
import type { Backlinks } from './generated/Backlinks';
import type { BrokenLinksReport } from './generated/BrokenLinksReport';
import type { DocLinks } from './generated/DocLinks';
import type { GraphChangedEvent } from './generated/GraphChangedEvent';
import type { GraphProgressEvent } from './generated/GraphProgressEvent';
import type { GraphReadyEvent } from './generated/GraphReadyEvent';
import type { GraphStatus } from './generated/GraphStatus';
import type { IndexErrorEvent } from './generated/IndexErrorEvent';
import type { IndexProgressEvent } from './generated/IndexProgressEvent';
import type { IndexReadyEvent } from './generated/IndexReadyEvent';
import type { RecentFolder } from './generated/RecentFolder';
import type { RecentFilesListing } from './generated/RecentFilesListing';
import type { RecoveredEvent } from './generated/RecoveredEvent';
import type { RescanRequest } from './generated/RescanRequest';
import type { RootInfo } from './generated/RootInfo';
import type { Session } from './generated/Session';
import type { Settings } from './generated/Settings';
import type { SettingsPatch } from './generated/SettingsPatch';
import type { TextFileContent } from './generated/TextFileContent';
import type { WatchStatusEvent } from './generated/WatchStatusEvent';

export type {
  AppInfo,
  DirEntry,
  DirListing,
  ErrorCode,
  FileContent,
  FileEntry,
  FsChangesEvent,
  GraphChangedEvent,
  GraphProgressEvent,
  GraphReadyEvent,
  GraphStatus,
  IndexErrorEvent,
  IndexProgressEvent,
  IndexReadyEvent,
  RecentFilesListing,
  RecentFolder,
  RecoveredEvent,
  RescanRequest,
  RootInfo,
  Session,
  Settings,
  SettingsPatch,
  TextFileContent,
  WatchStatusEvent,
};
export type { RenamedPath } from './generated/RenamedPath';
export type { WatchMode } from './generated/WatchMode';
export type { Theme } from './generated/Theme';
export type { ReadingWidth } from './generated/ReadingWidth';
export type { WindowFrame } from './generated/WindowFrame';
export type { SessionTab } from './generated/SessionTab';
export type { SessionTabKind } from './generated/SessionTabKind';
export type { SidebarView } from './generated/SidebarView';
export type { LinkInfo } from './generated/LinkInfo';
export type { DocLinks } from './generated/DocLinks';
export type { Backlink } from './generated/Backlink';
export type { Backlinks } from './generated/Backlinks';
export type { BrokenDoc } from './generated/BrokenDoc';
export type { BrokenLinksReport } from './generated/BrokenLinksReport';
export type { LinkStatus } from './generated/LinkStatus';
export type { LinkTarget } from './generated/LinkTarget';
export type { RightPanelState } from './generated/RightPanelState';

/** Error raised by any backend call. */
export class BackendError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'BackendError';
    this.code = code;
  }
}

/** Events pushed by the backend, keyed by event name. */
export interface BackendEvents {
  'appdata://recovered': RecoveredEvent;
  'index://progress': IndexProgressEvent;
  'index://ready': IndexReadyEvent;
  'index://error': IndexErrorEvent;
  'fs://changes': FsChangesEvent;
  'fs://watch-status': WatchStatusEvent;
  'graph://progress': GraphProgressEvent;
  'graph://ready': GraphReadyEvent;
  'graph://changed': GraphChangedEvent;
}

export type EventName = keyof BackendEvents;
export type Unsubscribe = () => void;

export type ResizeDirection =
  'North' | 'South' | 'East' | 'West' | 'NorthEast' | 'NorthWest' | 'SouthEast' | 'SouthWest';

/** The main application window (no-ops outside Tauri). */
export interface AppWindow {
  show(): Promise<void>;
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
  /** Closes without running close-requested handlers (after they flushed state). */
  destroy(): Promise<void>;
  isMaximized(): Promise<boolean>;
  startResizeDragging(direction: ResizeDirection): Promise<void>;
  setDecorations(decorations: boolean): Promise<void>;
  setTitle(title: string): Promise<void>;
  onResized(handler: () => void): Promise<Unsubscribe>;
  onFocusChanged(handler: (focused: boolean) => void): Promise<Unsubscribe>;
  /** Called with `true` when the OS switches to a dark theme. */
  onThemeChanged(handler: (dark: boolean) => void): Promise<Unsubscribe>;
  /** Runs `handler` before the window closes; the window closes once it resolves. */
  onCloseRequested(handler: () => Promise<void>): Promise<Unsubscribe>;
}

export interface Backend {
  window: AppWindow;

  /** Shows the system folder picker; resolves to the chosen absolute path or null. */
  pickFolder(): Promise<string | null>;
  /** Opens a folder and starts indexing it in the background (see the index:// events). */
  openRoot(path: string): Promise<RootInfo>;
  closeRoot(): Promise<void>;
  /** Restarts indexing with new toggles; resolves to the new generation. */
  rescan(request: RescanRequest): Promise<number>;
  /** Lists an indexed folder (root-relative path, "" for the root). */
  listDir(relPath: string): Promise<DirListing>;
  /** Markdown files sorted by last modification, newest first. */
  listRecentFiles(offset: number, limit: number): Promise<RecentFilesListing>;
  /** Reads a markdown file of the open folder. */
  readMarkdown(relPath: string): Promise<FileContent>;
  /** Reads any text file of the open folder (NotText for binaries, TooLarge above 5 MB). */
  readTextFile(relPath: string): Promise<TextFileContent>;
  /** Opens a text file with the system's default app (Forbidden for programs and scripts). */
  openWithDefaultApp(relPath: string): Promise<void>;
  /** Shows a file or folder of the open folder in the system file manager. */
  revealInFileManager(relPath: string): Promise<void>;
  /** URL the webview can load a file of the open folder from (images, videos). */
  assetUrl(rootPath: string, relPath: string): string;
  /** Opens a media file of the open folder with the system's default application. */
  openExternal(relPath: string): Promise<void>;
  /** Opens an http(s) or mailto URL in the system browser or mail client. */
  openUrl(url: string): Promise<void>;

  /** Progress of the document graph build and the number of broken links. */
  getGraphStatus(): Promise<GraphStatus>;
  /** The links of a document with their status (empty for unparsed documents). */
  getDocLinks(relPath: string): Promise<DocLinks>;
  /** The documents linking to a document. */
  getBacklinks(relPath: string): Promise<Backlinks>;
  /** Every broken link of the folder, grouped by document. */
  listBrokenLinks(): Promise<BrokenLinksReport>;

  getSettings(): Promise<Settings>;
  updateSettings(patch: SettingsPatch): Promise<Settings>;
  getRecentFolders(): Promise<RecentFolder[]>;
  removeRecentFolder(path: string): Promise<RecentFolder[]>;
  clearRecentFolders(): Promise<RecentFolder[]>;
  getSession(rootPath: string): Promise<Session | null>;
  saveSession(rootPath: string, session: Session): Promise<void>;
  getAppInfo(): Promise<AppInfo>;
  /** Opens the app-data folder in the system file manager. */
  openAppDataDir(): Promise<void>;

  listen<E extends EventName>(
    event: E,
    handler: (payload: BackendEvents[E]) => void,
  ): Promise<Unsubscribe>;
}
