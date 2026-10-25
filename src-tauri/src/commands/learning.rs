//! Learning commands (quiz, later tutorials): the project profile and its corrections. All of
//! them are local and spend no token; the only generation is `ai_start`.

use tauri::{AppHandle, Manager, State};

use crate::commands::appdata::notify_recovered;
use crate::error::{AppError, AppResult};
use crate::learning::{self, root_key};
use crate::profile::{ProfileCorrections, ProjectProfile};
use crate::state::AppState;

/// The profile of the open folder (one local walk, cached until the disk changes; `force`
/// rebuilds), with the user's corrections applied.
#[tauri::command]
pub async fn get_project_profile(app: AppHandle, force: Option<bool>) -> AppResult<ProjectProfile> {
    let force = force.unwrap_or(false);
    let handle = app.clone();
    let profile = tauri::async_runtime::spawn_blocking(move || {
        let state = handle.state::<AppState>();
        state.with_workspace(|ws| {
            learning::corrected_profile(ws, &state.appdata, force).map(|(p, _)| p)
        })
    })
    .await
    .map_err(|e| AppError::Io(std::io::Error::other(e.to_string())))?;
    notify_recovered(&app, &app.state::<AppState>().appdata);
    profile
}

/// Saves the corrections of the open folder in app data and returns the corrected profile.
#[tauri::command]
pub async fn set_profile_corrections(
    app: AppHandle,
    corrections: ProfileCorrections,
) -> AppResult<ProjectProfile> {
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state: State<'_, AppState> = handle.state::<AppState>();
        let mut corrections = corrections;
        corrections.normalize();
        state.with_workspace(|ws| {
            state
                .appdata
                .update_folder_learning(&root_key(ws), |l| l.profile_corrections = corrections)?;
            learning::corrected_profile(ws, &state.appdata, false).map(|(p, _)| p)
        })
    })
    .await
    .map_err(|e| AppError::Io(std::io::Error::other(e.to_string())))?
}
