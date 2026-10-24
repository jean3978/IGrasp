//! Opening and closing the root folder, scanning it and listing its folders.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use ts_rs::TS;

use crate::appdata::now_ms;
use crate::error::{AppError, AppResult};
use crate::index::model::{DirListing, FileEntry};
use crate::index::scanner::ScanOptions;
use crate::index::start_scan;
use crate::paths::RootGuard;
use crate::state::{AppState, Workspace};

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RootInfo {
    /// Canonical absolute path of the folder.
    pub path: String,
    /// Folder name, shown in the title bar.
    pub name: String,
    pub is_git_repo: bool,
    pub generation: u64,
    /// Effective toggles for this folder (from its saved session, else the settings defaults).
    pub show_dotfiles: bool,
    pub show_ignored: bool,
}

#[derive(Debug, Clone, Default, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, optional_fields)]
pub struct RescanRequest {
    pub show_dotfiles: Option<bool>,
    pub show_ignored: Option<bool>,
}

fn folder_name(guard: &RootGuard) -> String {
    guard
        .root()
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| guard.root().display().to_string())
}

fn spawn_scan(app: &AppHandle, ws: &Workspace) {
    start_scan(app.clone(), ws.scan_context());
}

#[tauri::command]
pub fn open_root(app: AppHandle, state: State<'_, AppState>, path: String) -> AppResult<RootInfo> {
    let guard = RootGuard::new(&PathBuf::from(&path))?;
    let root = guard.root().to_path_buf();
    let root_str = root.display().to_string();

    // Let the webview load images and videos from this folder through the asset protocol. The
    // scope cannot be narrowed again later; see docs/decisions/0002.
    app.asset_protocol_scope()
        .allow_directory(&root, true)
        .map_err(|e| AppError::InvalidPath(format!("cannot allow asset access: {e}")))?;

    let settings = state.appdata.settings()?;
    let session = state.appdata.with_sessions(|s| s.get(&root_str))?;
    let options = ScanOptions {
        show_dotfiles: session
            .as_ref()
            .map_or(settings.show_dotfiles, |s| s.show_dotfiles),
        show_ignored: session
            .as_ref()
            .map_or(settings.show_ignored, |s| s.show_ignored),
        extra_ignores: settings.ignore_patterns,
    };

    let info = RootInfo {
        path: root_str,
        name: folder_name(&guard),
        is_git_repo: root.join(".git").exists(),
        generation: state.next_generation(),
        show_dotfiles: options.show_dotfiles,
        show_ignored: options.show_ignored,
    };

    {
        let mut slot = state.workspace.write().unwrap_or_else(|e| e.into_inner());
        // Dropping the previous workspace cancels its scan.
        let ws = Workspace::new(guard, info.generation, options);
        spawn_scan(&app, &ws);
        *slot = Some(ws);
    }

    state
        .appdata
        .with_recent(|r| r.touch(&info.path, &info.name, now_ms()))?;
    log::info!("opened {}", info.path);
    Ok(info)
}

#[tauri::command]
pub fn close_root(state: State<'_, AppState>) {
    let mut ws = state.workspace.write().unwrap_or_else(|e| e.into_inner());
    if let Some(old) = ws.take() {
        log::info!("closed {}", old.guard.root().display());
    }
}

/// Restarts the scan, e.g. after a toggle or the ignore patterns changed. Returns the new
/// generation.
#[tauri::command]
pub fn rescan(
    app: AppHandle,
    state: State<'_, AppState>,
    request: RescanRequest,
) -> AppResult<u64> {
    let extra_ignores = state.appdata.settings()?.ignore_patterns;
    let generation = state.next_generation();
    let mut slot = state.workspace.write().unwrap_or_else(|e| e.into_inner());
    let old = slot.take().ok_or(AppError::NoRootOpen)?;
    let options = ScanOptions {
        show_dotfiles: request.show_dotfiles.unwrap_or(old.options.show_dotfiles),
        show_ignored: request.show_ignored.unwrap_or(old.options.show_ignored),
        extra_ignores,
    };
    let ws = Workspace::new(old.guard.clone(), generation, options);
    drop(old);
    spawn_scan(&app, &ws);
    *slot = Some(ws);
    Ok(generation)
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RecentFilesListing {
    pub generation: u64,
    /// Number of markdown files in the index.
    pub total: u32,
    /// Newest first.
    pub files: Vec<FileEntry>,
}

/// Markdown files sorted by last modification, newest first (the Recent changes view).
#[tauri::command]
pub fn list_recent_files(
    state: State<'_, AppState>,
    offset: u32,
    limit: u32,
) -> AppResult<RecentFilesListing> {
    state.with_workspace(|ws| {
        let index = ws.index.read().unwrap_or_else(|e| e.into_inner());
        let index = index.as_ref().ok_or(AppError::IndexNotReady)?;
        let (total, files) = index.recent_files(offset as usize, limit.min(5_000) as usize);
        Ok(RecentFilesListing {
            generation: ws.generation,
            total: u32::try_from(total).unwrap_or(u32::MAX),
            files,
        })
    })
}

#[tauri::command]
pub fn list_dir(state: State<'_, AppState>, rel_path: String) -> AppResult<DirListing> {
    state.with_workspace(|ws| {
        // Validates the path shape; listing comes from the index, not the disk.
        ws.guard.join_lexical(&rel_path)?;
        let index = ws.index.read().unwrap_or_else(|e| e.into_inner());
        let index = index.as_ref().ok_or(AppError::IndexNotReady)?;
        let (dirs, files) = index
            .list_dir(&rel_path)
            .ok_or_else(|| AppError::NotFound(rel_path.clone()))?;
        Ok(DirListing {
            rel_path: rel_path.clone(),
            generation: ws.generation,
            dirs,
            files,
        })
    })
}
