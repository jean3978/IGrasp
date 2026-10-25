//! Tutorial commands (Hoot's Academy). All of them are local and spend no token: the subject
//! cards, the private tutorials and their progress in app data, the shared tutorials of the
//! folder, the freshness check, sharing and verifying. The generations (outline, chapters,
//! review, suggestions) go through `ai_start` like every AI operation.

use std::path::Path;

use tauri::{AppHandle, Manager, State};

use crate::appdata::AppData;
use crate::appdata::tutorials::{StoredTutorial, TutorialSummary};
use crate::commands::appdata::notify_recovered;
use crate::error::{AppError, AppResult};
use crate::learning::tutorial::families::{TutorialSubject, TutorialSubjects};
use crate::learning::tutorial::progress::TutorialProgress;
use crate::learning::tutorial::schema::Tutorial;
use crate::learning::tutorial::{TutorialRef, compose, freshness, markdown, new_tutorial_id, repo};
use crate::learning::{self, root_key};
use crate::state::{AppState, Workspace};

fn blocking_error(e: impl std::fmt::Display) -> AppError {
    AppError::Io(std::io::Error::other(e.to_string()))
}

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
    .map_err(blocking_error)?;
    notify_recovered(&app, &app.state::<AppState>().appdata);
    subjects
}

/// The library of the open folder: its private tutorials, newest first, with the progress.
pub fn library(ws: &Workspace, appdata: &AppData) -> AppResult<Vec<TutorialSummary>> {
    let key = root_key(ws);
    let progress = appdata.folder_learning(&key)?.tutorial_progress;
    Ok(appdata
        .private_tutorials(&key)?
        .into_iter()
        .map(|s| {
            TutorialSummary::of(
                TutorialRef::Private {
                    id: s.tutorial.id.clone(),
                },
                &s.tutorial,
                s.shared_as.clone(),
                s.updated_ms,
                progress.get(&s.tutorial.id),
            )
        })
        .collect())
}

/// The tutorials of the open folder (private ones, and later the shared ones), for the
/// Academy's library. Local.
#[tauri::command]
pub fn list_tutorials(
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<Vec<TutorialSummary>> {
    let list = state.with_workspace(|ws| library(ws, &state.appdata));
    notify_recovered(&app, &state.appdata);
    list
}

/// A tutorial to take: a private one from app data.
pub fn read_tutorial(ws: &Workspace, appdata: &AppData, r: &TutorialRef) -> AppResult<Tutorial> {
    match r {
        TutorialRef::Private { id } => Ok(appdata.private_tutorial(&root_key(ws), id)?.tutorial),
        TutorialRef::Shared { rel_path } => Err(AppError::NotATutorialFile(rel_path.clone())),
    }
}

#[tauri::command]
pub fn get_tutorial(
    app: AppHandle,
    state: State<'_, AppState>,
    reference: TutorialRef,
) -> AppResult<Tutorial> {
    let t = state.with_workspace(|ws| read_tutorial(ws, &state.appdata, &reference));
    notify_recovered(&app, &state.appdata);
    t
}

/// What a save of `t` stores: a new tutorial gets its id, date, provider and generation commit;
/// the texts are normalized (the shared format's round trip), and the cited ranges are hashed
/// (a citation already recorded keeps its hash).
pub fn prepared(root: &Path, provider_id: &str, mut t: Tutorial) -> Tutorial {
    if t.generated.trim().is_empty() {
        t.generated = compose::rfc3339_now();
    }
    if t.id.trim().is_empty() {
        t.id = new_tutorial_id(&t.subject, &t.generated);
        if t.generation_commit.is_none() {
            t.generation_commit = repo::head_commit(root);
        }
    }
    if t.provider.trim().is_empty() {
        provider_id.clone_into(&mut t.provider);
    }
    markdown::normalize(&mut t);
    t.sources = freshness::merge_source_hashes(root, &t);
    t
}

/// Saves a private tutorial of the open folder (after its outline, each chapter, accepted
/// proposals) and returns what was stored. The AI never calls this: the frontend does, with what
/// the user accepted.
#[tauri::command]
pub fn save_tutorial(state: State<'_, AppState>, tutorial: Tutorial) -> AppResult<StoredTutorial> {
    let provider = state.ai.provider_id();
    state.with_workspace(|ws| {
        let t = prepared(ws.guard.root(), provider, tutorial);
        state.appdata.save_private_tutorial(&root_key(ws), t)
    })
}

/// Deletes a private tutorial and the progress in it (its shared copy, if any, stays).
#[tauri::command]
pub fn delete_tutorial(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.with_workspace(|ws| state.appdata.delete_private_tutorial(&root_key(ws), &id))
}

/// Settings → "Forget tutorials and progress" of the open folder (shared tutorials stay).
#[tauri::command]
pub fn forget_tutorials(state: State<'_, AppState>) -> AppResult<()> {
    state.with_workspace(|ws| state.appdata.forget_tutorials(&root_key(ws)))
}

/// Keeps the subjects the AI suggested ("Suggest more subjects") with the folder; returns all
/// of them.
#[tauri::command]
pub fn save_suggested_subjects(
    state: State<'_, AppState>,
    subjects: Vec<TutorialSubject>,
) -> AppResult<Vec<TutorialSubject>> {
    state.with_workspace(|ws| {
        state
            .appdata
            .save_suggested_subjects(&root_key(ws), subjects)
    })
}

#[tauri::command]
pub fn get_tutorial_progress(
    state: State<'_, AppState>,
    id: String,
) -> AppResult<Option<TutorialProgress>> {
    state.with_workspace(|ws| state.appdata.tutorial_progress(&root_key(ws), &id))
}

/// Saves the reader's progress (after each step).
#[tauri::command]
pub fn save_tutorial_progress(
    state: State<'_, AppState>,
    progress: TutorialProgress,
) -> AppResult<()> {
    state.with_workspace(|ws| {
        state
            .appdata
            .save_tutorial_progress(&root_key(ws), progress)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::index::scanner::ScanOptions;
    use crate::learning::tutorial::markdown::tests::sample;
    use crate::paths::RootGuard;
    use crate::profile::tests::tree;

    #[test]
    fn a_new_tutorial_gets_its_id_and_hashes_and_keeps_old_hashes() {
        let dir = tree(&[(
            "src/index/watcher.rs",
            "a\npub const DEBOUNCE_MS: u64 = 200;\nb\nc\nd\ne\nf\n",
        )]);
        let appdata = tempfile::tempdir().unwrap();
        let appdata = AppData::new(appdata.path().to_path_buf());
        let ws = Workspace::new(
            RootGuard::new(dir.path()).unwrap(),
            1,
            ScanOptions::default(),
        );
        let mut t = sample();
        t.id = String::new();
        t.generated = String::new();
        t.provider = String::new();
        t.sources.clear();
        let t = prepared(ws.guard.root(), "mock", t);
        assert!(t.id.starts_with("how-the-watcher-works-"), "{}", t.id);
        assert!(t.id.len() <= 40 + 15);
        assert_eq!(t.provider, "mock");
        assert!(!t.sources.is_empty());
        assert!(t.sources.iter().all(|s| s.sha256.is_some()));
        // The file changes: a later save keeps the recorded hashes.
        std::fs::write(
            dir.path().join("src/index/watcher.rs"),
            "changed\n".repeat(9),
        )
        .unwrap();
        let again = prepared(ws.guard.root(), "mock", t.clone());
        assert_eq!(again.sources, t.sources);
        assert_eq!(again.id, t.id);

        appdata
            .save_private_tutorial(&root_key(&ws), again)
            .unwrap();
        let list = library(&ws, &appdata).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].chapters_written, 1);
        let back =
            read_tutorial(&ws, &appdata, &TutorialRef::Private { id: t.id.clone() }).unwrap();
        assert_eq!(back.id, t.id);
    }
}
