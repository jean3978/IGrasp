//! Settings, recent folders, sessions and app information.

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use ts_rs::TS;

use crate::appdata::recent::RecentFolder;
use crate::appdata::session::Session;
use crate::appdata::settings::{Settings, SettingsPatch};
use crate::appdata::{AppData, now_ms};
use crate::error::AppResult;
use crate::state::AppState;

pub const EVENT_RECOVERED: &str = "appdata://recovered";

/// Payload of `appdata://recovered`: an app-data file was corrupt and reset to defaults.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct RecoveredEvent {
    pub file: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AppInfo {
    pub version: String,
    pub tauri_version: String,
    pub os: String,
    pub app_data_dir: String,
    pub log_dir: String,
}

/// Tells the frontend about app-data files that had to be reset.
pub fn notify_recovered(app: &AppHandle, data: &AppData) {
    for file in data.take_recovered() {
        if let Err(e) = app.emit(EVENT_RECOVERED, RecoveredEvent { file }) {
            log::warn!("cannot emit {EVENT_RECOVERED}: {e}");
        }
    }
}

#[tauri::command]
pub fn get_settings(app: AppHandle, state: State<'_, AppState>) -> AppResult<Settings> {
    let settings = state.appdata.settings();
    notify_recovered(&app, &state.appdata);
    settings
}

#[tauri::command]
pub fn update_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    patch: SettingsPatch,
) -> AppResult<Settings> {
    let settings = state.appdata.update_settings(|s| patch.apply(s));
    notify_recovered(&app, &state.appdata);
    settings
}

#[tauri::command]
pub fn get_recent_folders(
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<Vec<RecentFolder>> {
    let list = state.appdata.with_recent(|r| r.list());
    notify_recovered(&app, &state.appdata);
    list
}

#[tauri::command]
pub fn remove_recent_folder(
    state: State<'_, AppState>,
    path: String,
) -> AppResult<Vec<RecentFolder>> {
    state.appdata.with_recent(|r| {
        r.remove(&path);
        r.list()
    })
}

#[tauri::command]
pub fn clear_recent_folders(state: State<'_, AppState>) -> AppResult<Vec<RecentFolder>> {
    state.appdata.with_recent(|r| {
        r.clear();
        r.list()
    })
}

#[tauri::command]
pub fn get_session(
    app: AppHandle,
    state: State<'_, AppState>,
    root_path: String,
) -> AppResult<Option<Session>> {
    let session = state.appdata.with_sessions(|s| s.get(&root_path));
    notify_recovered(&app, &state.appdata);
    session
}

#[tauri::command]
pub fn save_session(
    state: State<'_, AppState>,
    root_path: String,
    session: Session,
) -> AppResult<()> {
    state
        .appdata
        .with_sessions(|s| s.put(&root_path, session, now_ms()))
}

/// Opens the app-data folder (settings, sessions, logs) in the system file manager.
#[tauri::command]
pub fn open_app_data_dir(state: State<'_, AppState>) -> AppResult<()> {
    let dir = state.appdata.dir();
    std::fs::create_dir_all(dir)?;
    tauri_plugin_opener::open_path(dir, None::<&str>)
        .map_err(|e| crate::error::AppError::Io(std::io::Error::other(e.to_string())))
}

#[tauri::command]
pub fn get_app_info(app: AppHandle, state: State<'_, AppState>) -> AppInfo {
    let log_dir = app
        .path()
        .app_log_dir()
        .map(|p| p.display().to_string())
        .unwrap_or_default();
    AppInfo {
        version: app.package_info().version.to_string(),
        tauri_version: tauri::VERSION.to_owned(),
        os: std::env::consts::OS.to_owned(),
        app_data_dir: state.appdata.dir().display().to_string(),
        log_dir,
    }
}
