//! Learning commands (quiz, later tutorials): the project profile and its corrections. All of
//! them are local and spend no token; the only generation is `ai_start`.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

use crate::appdata::learning::{QuizRecord, QuizSummary};
use crate::commands::appdata::notify_recovered;
use crate::error::{AppError, AppResult};
use crate::learning::quiz::file::{self, QuizFileSummary, QuizFileText};
use crate::learning::save::{self, QuizSaveKind, SaveDialog, SavedQuizFile};
use crate::learning::subjects::Subject;
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

/// Subject proposals for the open folder, from the profile and the corpus (local, no AI). "No
/// specific subject" is added by the UI.
#[tauri::command]
pub async fn list_subjects(app: AppHandle) -> AppResult<Vec<Subject>> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let names = state.ai.capabilities().context_file_names;
        state.with_workspace(|ws| learning::subjects(ws, &state.appdata, &names))
    })
    .await
    .map_err(|e| AppError::Io(std::io::Error::other(e.to_string())))?
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

/// The key of the open folder in app data.
fn folder_key(state: &AppState) -> AppResult<String> {
    state.with_workspace(|ws| Ok(root_key(ws)))
}

/// The quiz being played in the open folder (app data), if any.
#[tauri::command]
pub fn get_current_quiz(
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<Option<QuizRecord>> {
    let quiz = state.appdata.current_quiz(&folder_key(&state)?);
    notify_recovered(&app, &state.appdata);
    quiz
}

/// Saves the quiz being played (after each answer); a finished one moves to the history.
#[tauri::command]
pub fn save_current_quiz(state: State<'_, AppState>, record: QuizRecord) -> AppResult<()> {
    state
        .appdata
        .save_current_quiz(&folder_key(&state)?, record)
}

#[tauri::command]
pub fn clear_current_quiz(state: State<'_, AppState>) -> AppResult<()> {
    state.appdata.clear_current_quiz(&folder_key(&state)?)
}

/// The finished quizzes of the open folder, newest first.
#[tauri::command]
pub fn list_quiz_history(
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<Vec<QuizSummary>> {
    let history = state.appdata.quiz_history(&folder_key(&state)?);
    notify_recovered(&app, &state.appdata);
    history
}

/// A finished quiz of the open folder (for Play again).
#[tauri::command]
pub fn get_quiz_record(state: State<'_, AppState>, id: String) -> AppResult<QuizRecord> {
    state.appdata.quiz_record(&folder_key(&state)?, &id)
}

/// Forgets the open folder's quiz history and current quiz (saved quiz files stay).
#[tauri::command]
pub fn forget_quizzes(state: State<'_, AppState>) -> AppResult<()> {
    state.appdata.forget_quizzes(&folder_key(&state)?)
}

/// The quiz files of the open folder, newest first, from the graph (nothing read again).
#[tauri::command]
pub fn list_quiz_files(state: State<'_, AppState>) -> AppResult<Vec<QuizFileSummary>> {
    state.with_workspace(|ws| {
        let graph = ws.graph.read().unwrap_or_else(|e| e.into_inner());
        let index = ws.index.read().unwrap_or_else(|e| e.into_inner());
        let mut files: Vec<QuizFileSummary> = graph
            .docs()
            .filter_map(|(rel, doc)| {
                let quiz = doc.quiz.as_ref()?;
                Some(QuizFileSummary {
                    rel_path: rel.clone(),
                    title: quiz.title.clone(),
                    subject: quiz.subject.clone(),
                    generated: quiz.generated.clone(),
                    questions: quiz.questions,
                    category: quiz.category,
                    role: quiz.role.clone(),
                    modified_ms: index
                        .as_ref()
                        .and_then(|i| i.file(rel))
                        .map_or(0, |f| f.modified_ms),
                })
            })
            .collect();
        files.sort_by(|a, b| {
            b.modified_ms
                .cmp(&a.modified_ms)
                .then_with(|| a.rel_path.cmp(&b.rel_path))
        });
        Ok(files)
    })
}

/// A quiz file to play: `rel_path` inside the folder (Saved quizzes, the preview's banner), or
/// the file the user picks in the open dialog (Open quiz file…, anywhere). `SaveCancelled` when
/// the dialog is dismissed, `NotAQuizFile` without the quiz front matter.
#[tauri::command]
pub async fn read_quiz_file(app: AppHandle, rel_path: Option<String>) -> AppResult<QuizFileText> {
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = handle.state::<AppState>();
        let (root, inside) = state.with_workspace(|ws| {
            let inside = rel_path
                .as_deref()
                .map(|rel| ws.guard.resolve(rel))
                .transpose()?;
            Ok((ws.guard.root().to_path_buf(), inside))
        })?;
        let path = match inside {
            Some(path) => path,
            None => handle
                .dialog()
                .file()
                .set_title("Open quiz file")
                .set_directory(&root)
                .add_filter("Markdown", &["md", "markdown"])
                .blocking_pick_file()
                .and_then(|p| p.into_path().ok())
                .ok_or(AppError::SaveCancelled)?,
        };
        file::read(&root, &path)
    })
    .await
    .map_err(|e| AppError::Io(std::io::Error::other(e.to_string())))?
}

/// The system's save dialog.
struct NativeSaveDialog<'a> {
    app: &'a AppHandle,
}

impl SaveDialog for NativeSaveDialog<'_> {
    fn pick(&self, directory: &Path, file_name: &str) -> Option<PathBuf> {
        self.app
            .dialog()
            .file()
            .set_title("Save as")
            .set_directory(directory)
            .set_file_name(file_name)
            .add_filter("Markdown", &["md"])
            .blocking_save_file()
            .and_then(|p| p.into_path().ok())
    }
}

/// "Save results…" and "Save quiz…": the save dialog (on the folder of the kind), then the
/// markdown written where the user chose. `SaveCancelled` when the dialog is dismissed.
#[tauri::command]
pub async fn save_quiz_markdown(
    app: AppHandle,
    kind: QuizSaveKind,
    markdown: String,
    suggested_name: String,
) -> AppResult<SavedQuizFile> {
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = handle.state::<AppState>();
        let root = state.with_workspace(|ws| Ok(ws.guard.root().to_path_buf()))?;
        let learning = state.appdata.settings()?.learning;
        save::save(
            &root,
            &learning,
            kind,
            &markdown,
            &suggested_name,
            &NativeSaveDialog { app: &handle },
        )
    })
    .await
    .map_err(|e| AppError::Io(std::io::Error::other(e.to_string())))?
}
