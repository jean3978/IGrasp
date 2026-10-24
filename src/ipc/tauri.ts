// Backend implementation over Tauri IPC. This is the only module that calls `invoke` and `listen`.

import { convertFileSrc, invoke as tauriInvoke } from '@tauri-apps/api/core';
import { listen as tauriListen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import { toAbsolute } from '../lib/paths';
import { BackendError } from './types';
import type { AppWindow, Backend, ErrorCode } from './types';

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

// Resolved lazily: this module is imported (but unused) outside Tauri, where the runtime is absent.
const win = () => getCurrentWindow();

const appWindow: AppWindow = {
  show: () => win().show(),
  minimize: () => win().minimize(),
  toggleMaximize: () => win().toggleMaximize(),
  close: () => win().close(),
  destroy: () => win().destroy(),
  isMaximized: () => win().isMaximized(),
  startResizeDragging: (direction) => win().startResizeDragging(direction),
  setDecorations: (decorations) => win().setDecorations(decorations),
  setTitle: (title) => win().setTitle(title),
  onResized: (handler) =>
    win().onResized(() => {
      handler();
    }),
  onFocusChanged: (handler) =>
    win().onFocusChanged((e) => {
      handler(e.payload);
    }),
  onThemeChanged: (handler) =>
    win().onThemeChanged((e) => {
      handler(e.payload === 'dark');
    }),
  onCloseRequested: (handler) =>
    win().onCloseRequested(async (e) => {
      e.preventDefault();
      try {
        await handler();
      } finally {
        await win().destroy();
      }
    }),
};

export const tauriBackend: Backend = {
  window: appWindow,

  pickFolder: async () => {
    const picked = await openDialog({ directory: true, multiple: false, title: 'Open Folder' });
    return typeof picked === 'string' ? picked : null;
  },
  openRoot: (path) => invoke('open_root', { path }),
  closeRoot: () => invoke('close_root'),
  rescan: (request) => invoke('rescan', { request }),
  listDir: (relPath) => invoke('list_dir', { relPath }),
  listRecentFiles: (offset, limit) => invoke('list_recent_files', { offset, limit }),
  readMarkdown: (relPath) => invoke('read_markdown', { relPath }),
  readTextFile: (relPath) => invoke('read_text_file', { relPath }),
  openWithDefaultApp: (relPath) => invoke('open_with_default_app', { relPath }),
  revealInFileManager: (relPath) => invoke('reveal_in_file_manager', { relPath }),
  assetUrl: (rootPath, relPath) => convertFileSrc(toAbsolute(rootPath, relPath)),
  openExternal: (relPath) => invoke('open_external', { relPath }),
  openUrl: (url) => openUrl(url),

  getGraphStatus: () => invoke('get_graph_status'),
  getDocLinks: (relPath) => invoke('get_doc_links', { relPath }),
  getBacklinks: (relPath) => invoke('get_backlinks', { relPath }),
  listBrokenLinks: () => invoke('list_broken_links'),
  searchSymbols: (request) => invoke('search_symbols', { ...request }),
  searchText: (request) => invoke('search_text', { request }),
  cancelSearch: (searchId) => invoke('cancel_search', { searchId }),

  getSettings: () => invoke('get_settings'),
  updateSettings: (patch) => invoke('update_settings', { patch }),
  getRecentFolders: () => invoke('get_recent_folders'),
  removeRecentFolder: (path) => invoke('remove_recent_folder', { path }),
  clearRecentFolders: () => invoke('clear_recent_folders'),
  getSession: (rootPath) => invoke('get_session', { rootPath }),
  saveSession: (rootPath, session) => invoke('save_session', { rootPath, session }),
  getAppInfo: () => invoke('get_app_info'),
  openAppDataDir: () => invoke('open_app_data_dir'),

  aiStatus: (force) => invoke('ai_status', { force: force ?? false }),
  aiCapabilities: () => invoke('ai_capabilities'),
  aiProviders: () => invoke('ai_providers'),
  aiSetProvider: (id) => invoke('ai_set_provider', { id }),
  aiContext: (currentPath) => invoke('ai_context', { currentPath }),
  aiEstimate: (input) => invoke('ai_estimate', { input }),
  aiStart: (action, request) => invoke('ai_start', { action, request }),
  aiRespondPermission: (operationId, requestId, decision) =>
    invoke('ai_respond_permission', { operationId, requestId, decision }),
  aiCancel: (operationId) => invoke('ai_cancel', { operationId }),

  listen: (event, handler) =>
    tauriListen<Parameters<typeof handler>[0]>(event, (e) => {
      handler(e.payload);
    }),
};
