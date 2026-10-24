// The contract between the frontend and a backend implementation (real Tauri or in-memory mock).
// Types under ./generated are exported from Rust by ts-rs; never edit them by hand.

import type { AppInfo } from './generated/AppInfo';
import type { ErrorCode } from './generated/ErrorCode';
import type { RecentFolder } from './generated/RecentFolder';
import type { RecoveredEvent } from './generated/RecoveredEvent';
import type { Session } from './generated/Session';
import type { Settings } from './generated/Settings';
import type { SettingsPatch } from './generated/SettingsPatch';

export type { AppInfo, ErrorCode, RecentFolder, RecoveredEvent, Session, Settings, SettingsPatch };
export type { Theme } from './generated/Theme';
export type { ReadingWidth } from './generated/ReadingWidth';
export type { WindowFrame } from './generated/WindowFrame';
export type { SessionTab } from './generated/SessionTab';

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

  getSettings(): Promise<Settings>;
  updateSettings(patch: SettingsPatch): Promise<Settings>;
  getRecentFolders(): Promise<RecentFolder[]>;
  removeRecentFolder(path: string): Promise<RecentFolder[]>;
  clearRecentFolders(): Promise<RecentFolder[]>;
  getSession(rootPath: string): Promise<Session | null>;
  saveSession(rootPath: string, session: Session): Promise<void>;
  getAppInfo(): Promise<AppInfo>;

  listen<E extends EventName>(
    event: E,
    handler: (payload: BackendEvents[E]) => void,
  ): Promise<Unsubscribe>;
}
