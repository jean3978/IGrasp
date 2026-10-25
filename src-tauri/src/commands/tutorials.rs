//! Tutorial commands (Hoot's Academy). All of them are local and spend no token: the subject
//! cards, the private tutorials and their progress in app data, the shared tutorials of the
//! folder, the freshness check, sharing and verifying. The generations (outline, chapters,
//! review, suggestions) go through `ai_start` like every AI operation.

use tauri::{AppHandle, Manager};

use crate::commands::appdata::notify_recovered;
use crate::error::{AppError, AppResult};
use crate::learning;
use crate::learning::tutorial::families::TutorialSubjects;
use crate::state::AppState;

/// The Academy's subject cards and the domains for "I'm new to…" of the open folder (local: the
/// profile, the corpus and the subject detection, no AI), then the subjects the AI suggested.
#[tauri::command]
pub async fn list_tutorial_subjects(app: AppHandle) -> AppResult<TutorialSubjects> {
    let handle = app.clone();
    let subjects = tauri::async_runtime::spawn_blocking(move || {
        let state = handle.state::<AppState>();
        let names = state.ai.capabilities().context_file_names;
        state.with_workspace(|ws| learning::tutorial_subjects(ws, &state.appdata, &names))
    })
    .await
    .map_err(|e| AppError::Io(std::io::Error::other(e.to_string())))?;
    notify_recovered(&app, &app.state::<AppState>().appdata);
    subjects
}
