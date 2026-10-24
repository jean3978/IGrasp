//! Opening and closing the root folder.

use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use ts_rs::TS;

use crate::appdata::now_ms;
use crate::error::{AppError, AppResult};
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
}

fn folder_name(guard: &RootGuard) -> String {
    guard
        .root()
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| guard.root().display().to_string())
}

#[tauri::command]
pub fn open_root(app: AppHandle, state: State<'_, AppState>, path: String) -> AppResult<RootInfo> {
    let guard = RootGuard::new(&PathBuf::from(&path))?;
    let root = guard.root().to_path_buf();

    // Let the webview load images and videos from this folder through the asset protocol. The
    // scope cannot be narrowed again later; see docs/decisions/0002.
    app.asset_protocol_scope()
        .allow_directory(&root, true)
        .map_err(|e| AppError::InvalidPath(format!("cannot allow asset access: {e}")))?;

    let info = RootInfo {
        path: root.display().to_string(),
        name: folder_name(&guard),
        is_git_repo: root.join(".git").exists(),
        generation: state.next_generation(),
    };

    {
        let mut ws = state.workspace.write().unwrap_or_else(|e| e.into_inner());
        *ws = Some(Workspace {
            guard,
            generation: info.generation,
        });
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
