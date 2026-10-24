// Backend implementation over Tauri IPC. This is the only module that calls `invoke` and `listen`.

import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { listen as tauriListen } from '@tauri-apps/api/event';
import { BackendError } from './types';
import type { Backend, ErrorCode } from './types';

function isIpcError(value: unknown): value is { code: ErrorCode; message: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    'message' in value &&
    typeof value.message === 'string'
  );
}

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await tauriInvoke<T>(command, args);
  } catch (err) {
    if (isIpcError(err)) throw new BackendError(err.code, err.message);
    throw new BackendError('Io', String(err));
  }
}

export const tauriBackend: Backend = {
  getSettings: () => invoke('get_settings'),
  updateSettings: (patch) => invoke('update_settings', { patch }),
  getRecentFolders: () => invoke('get_recent_folders'),
  removeRecentFolder: (path) => invoke('remove_recent_folder', { path }),
  clearRecentFolders: () => invoke('clear_recent_folders'),
  getSession: (rootPath) => invoke('get_session', { rootPath }),
  saveSession: (rootPath, session) => invoke('save_session', { rootPath, session }),
  getAppInfo: () => invoke('get_app_info'),

  listen: (event, handler) =>
    tauriListen<Parameters<typeof handler>[0]>(event, (e) => {
      handler(e.payload);
    }),
};
