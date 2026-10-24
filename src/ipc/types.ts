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

export interface Backend {
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
