//! Tutorial commands (Hoot's Academy). All of them are local and spend no token: the subject
//! cards, the private tutorials and their progress in app data, the shared tutorials of the
//! folder, the freshness check, sharing and verifying. The generations (outline, chapters,
//! review, suggestions) go through `ai_start` like every AI operation.

use std::path::Path;

use tauri::{AppHandle, Manager, State};

use crate::appdata::AppData;
use crate::appdata::tutorials::{StoredTutorial, TutorialSummary};
use crate::commands::appdata::notify_recovered;
use crate::commands::learning::NativeSaveDialog;
use crate::error::{AppError, AppResult};
use crate::learning::save::SaveDialog;
use crate::learning::tutorial::families::{TutorialSubject, TutorialSubjects};
use crate::learning::tutorial::freshness::FreshnessReport;
use crate::learning::tutorial::progress::TutorialProgress;
use crate::learning::tutorial::question;
use crate::learning::tutorial::schema::{StepQuestion, Tutorial, Verification};
use crate::learning::tutorial::share::{self, WritePlan, WriteTarget, WrittenTutorial};
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

/// The library of the open folder: its private tutorials (newest first), then the shared ones
/// the graph found (each README read again, chapters included), with the progress. A shared copy
/// of one of the private tutorials (its "shared as", holding the same id) whose files are exactly
/// what sharing it writes is that tutorial: it is listed once, as the private one, without being
/// parsed. A copy that differs (changed since, maybe by a teammate) is listed too, and the
/// private one is marked `shared_differs`.
pub fn library(ws: &Workspace, appdata: &AppData) -> AppResult<Vec<TutorialSummary>> {
    let key = root_key(ws);
    let progress = appdata.folder_learning(&key)?.tutorial_progress;
    let root = ws.guard.root();
    let stored = appdata.private_tutorials(&key)?;
    let mut list: Vec<TutorialSummary> = stored
        .iter()
        .map(|s| {
            let mut summary = TutorialSummary::of(
                TutorialRef::Private {
                    id: s.tutorial.id.clone(),
                },
                &s.tutorial,
                s.shared_as.clone(),
                s.updated_ms,
                progress.get(&s.tutorial.id),
            );
            summary.freshness = Some(freshness::check(root, &s.tutorial).badge);
            summary
        })
        .collect();
    // README → id, as the graph read them.
    let readmes: Vec<(String, String)> = {
        let graph = ws.graph.read().unwrap_or_else(|e| e.into_inner());
        graph
            .docs()
            .filter_map(|(rel, doc)| {
                doc.tutorial
                    .as_ref()
                    .filter(|t| t.chapter.is_none())
                    .map(|t| (rel.clone(), t.id.clone()))
            })
            .collect()
    };
    let modified = |rel: &str| {
        let index = ws.index.read().unwrap_or_else(|e| e.into_inner());
        index
            .as_ref()
            .and_then(|i| i.file(rel))
            .map_or(0, |f| f.modified_ms)
    };
    let mut shared = Vec::new();
    for (rel, id) in readmes {
        let own = stored
            .iter()
            .position(|s| s.tutorial.id == id && s.shared_as.as_deref() == Some(rel.as_str()));
        if let Some(i) = own {
            match share::in_sync(&ws.guard, &rel, &stored[i].tutorial) {
                Ok(true) => continue,
                Ok(false) => list[i].shared_differs = true,
                Err(e) => log::warn!("{rel}: {e}"),
            }
        }
        match share::read_shared(&ws.guard, &rel) {
            Ok(t) => {
                let mut summary = TutorialSummary::of(
                    TutorialRef::Shared {
                        rel_path: rel.clone(),
                    },
                    &t,
                    None,
                    modified(&rel),
                    progress.get(&t.id),
                );
                summary.freshness = Some(freshness::check(root, &t).badge);
                shared.push(summary);
            }
            Err(e) => log::warn!("{rel}: {e}"),
        }
    }
    shared.sort_by_key(|s| std::cmp::Reverse(s.updated_ms));
    list.extend(shared);
    Ok(list)
}

/// The tutorials of the open folder (private and shared), for the Academy's library. Local.
#[tauri::command]
pub fn list_tutorials(
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<Vec<TutorialSummary>> {
    let list = state.with_workspace(|ws| library(ws, &state.appdata));
    notify_recovered(&app, &state.appdata);
    list
}

/// A tutorial to take: a private one from app data, a shared one from its files.
pub fn read_tutorial(ws: &Workspace, appdata: &AppData, r: &TutorialRef) -> AppResult<Tutorial> {
    match r {
        TutorialRef::Private { id } => Ok(appdata.private_tutorial(&root_key(ws), id)?.tutorial),
        TutorialRef::Shared { rel_path } => share::read_shared(&ws.guard, rel_path),
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

/// The local freshness check of a tutorial (no token): moved citations of a private tutorial
/// are relocated and saved; for a shared one the relocated version is returned, to write only
/// after the user confirms.
pub fn check_freshness(
    ws: &Workspace,
    appdata: &AppData,
    reference: &TutorialRef,
) -> AppResult<FreshnessReport> {
    let t = read_tutorial(ws, appdata, reference)?;
    let mut failed = None;
    let report = freshness::report(ws.guard.root(), &t, |copy| match reference {
        TutorialRef::Private { .. } => {
            if let Err(e) = appdata.save_private_tutorial(&root_key(ws), copy.clone()) {
                failed = Some(e);
            }
            true
        }
        TutorialRef::Shared { .. } => false,
    });
    match failed {
        Some(e) => Err(e),
        None => Ok(report),
    }
}

#[tauri::command]
pub fn check_tutorial_freshness(
    state: State<'_, AppState>,
    reference: TutorialRef,
) -> AppResult<FreshnessReport> {
    state.with_workspace(|ws| check_freshness(ws, &state.appdata, &reference))
}

/// "Mark as verified": the user states the tutorial is correct for the project as it is now.
/// Stamps the date, the HEAD commit and the git user name, and hashes the cited ranges again
/// (the freshness check starts from now). A private tutorial is saved; a shared one is returned
/// stamped, written only by `write_tutorial` after the confirmation. The AI never sets it.
pub fn verified(ws: &Workspace, appdata: &AppData, reference: &TutorialRef) -> AppResult<Tutorial> {
    let root = ws.guard.root();
    let mut t = read_tutorial(ws, appdata, reference)?;
    t.verified = Some(Verification {
        date: compose::rfc3339_now(),
        commit: repo::head_commit(root),
        by: repo::user_name(root),
    });
    t.sources = freshness::source_hashes(root, &t);
    if let TutorialRef::Private { .. } = reference {
        return Ok(appdata.save_private_tutorial(&root_key(ws), t)?.tutorial);
    }
    Ok(t)
}

#[tauri::command]
pub fn mark_tutorial_verified(
    state: State<'_, AppState>,
    reference: TutorialRef,
) -> AppResult<Tutorial> {
    state.with_workspace(|ws| verified(ws, &state.appdata, &reference))
}

/// A private tutorial is saved; a shared one is returned, written only by `write_tutorial`
/// after the confirmation.
fn saved_or_returned(
    ws: &Workspace,
    appdata: &AppData,
    reference: &TutorialRef,
    t: Tutorial,
) -> AppResult<Tutorial> {
    match reference {
        TutorialRef::Private { .. } => {
            Ok(appdata.save_private_tutorial(&root_key(ws), t)?.tutorial)
        }
        TutorialRef::Shared { .. } => Ok(t),
    }
}

/// Saves a reader's question and the answer on a step (no author, no date: anonymous once
/// shared). The user's action after the answer; the AI never calls this.
#[tauri::command]
pub fn save_step_question(
    state: State<'_, AppState>,
    reference: TutorialRef,
    chapter: u32,
    question: StepQuestion,
) -> AppResult<Tutorial> {
    state.with_workspace(|ws| {
        let t = read_tutorial(ws, &state.appdata, &reference)?;
        let t = question::with_question(&t, chapter, question)?;
        saved_or_returned(ws, &state.appdata, &reference, t)
    })
}

/// Removes a saved question (the `index`-th of the chapter).
#[tauri::command]
pub fn remove_step_question(
    state: State<'_, AppState>,
    reference: TutorialRef,
    chapter: u32,
    index: u32,
) -> AppResult<Tutorial> {
    state.with_workspace(|ws| {
        let t = read_tutorial(ws, &state.appdata, &reference)?;
        let t = question::without_question(&t, chapter, index)?;
        saved_or_returned(ws, &state.appdata, &reference, t)
    })
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

/// Deletes a private tutorial. Its shared copy, if any, stays, and so does the progress when that
/// copy still holds the tutorial (the same id: the progress is the shared copy's too).
pub fn delete(ws: &Workspace, appdata: &AppData, id: &str) -> AppResult<()> {
    let key = root_key(ws);
    let shared_stays = appdata
        .private_tutorial(&key, id)
        .ok()
        .and_then(|s| s.shared_as)
        .is_some_and(|readme| share::holds(&ws.guard, &readme, id).ok().flatten() == Some(true));
    appdata.delete_private_tutorial(&key, id, shared_stays)
}

#[tauri::command]
pub fn delete_tutorial(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.with_workspace(|ws| delete(ws, &state.appdata, &id))
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

/// The folder a write goes to and the tutorial it writes. `Shared` takes the new version from
/// the frontend (accepted changes) and requires the README on disk to hold the same tutorial;
/// `Share` and `Export` write the private copy as stored.
pub fn write_input(
    ws: &Workspace,
    appdata: &AppData,
    provider_id: &str,
    target: &WriteTarget,
    tutorial: Option<Tutorial>,
) -> AppResult<(String, Tutorial)> {
    let key = root_key(ws);
    match target {
        WriteTarget::Share { id } => {
            let stored = appdata.private_tutorial(&key, id)?;
            let folder = share::share_folder(
                &ws.guard,
                &appdata.settings()?.learning.tutorials_folder,
                &stored.tutorial,
                stored.shared_as.as_deref(),
            )?;
            Ok((folder, stored.tutorial))
        }
        WriteTarget::Export { id } => {
            Ok((String::new(), appdata.private_tutorial(&key, id)?.tutorial))
        }
        WriteTarget::Shared { rel_path } => {
            let on_disk = share::read_shared(&ws.guard, rel_path)?;
            let t = match tutorial {
                Some(t) if t.id == on_disk.id => prepared(ws.guard.root(), provider_id, t),
                Some(_) => {
                    return Err(AppError::NotATutorialFile(format!(
                        "{rel_path} holds another tutorial"
                    )));
                }
                None => on_disk,
            };
            Ok((share::folder_of(rel_path).to_owned(), t))
        }
    }
}

/// What a write would do (the files, new, changed or unchanged, and the chapter files removed),
/// for the confirmation. Writes nothing.
#[tauri::command]
pub fn plan_tutorial_write(
    state: State<'_, AppState>,
    target: WriteTarget,
    tutorial: Option<Tutorial>,
) -> AppResult<WritePlan> {
    let provider = state.ai.provider_id();
    state.with_workspace(|ws| {
        let (folder, t) = write_input(ws, &state.appdata, provider, &target, tutorial)?;
        if matches!(target, WriteTarget::Export { .. }) {
            // The folder is chosen in the dialog: every file is new there.
            return Ok(share::export_plan(&t));
        }
        share::plan(&ws.guard, &folder, &t)
    })
}

/// Writes a tutorial in the folder after the user confirmed the plan: Share with the project
/// (and records where on the private copy), an update of a shared tutorial, or Save as… (the
/// folder dialog runs here; `SaveCancelled` when dismissed).
#[tauri::command]
pub async fn write_tutorial(
    app: AppHandle,
    target: WriteTarget,
    tutorial: Option<Tutorial>,
) -> AppResult<WrittenTutorial> {
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = handle.state::<AppState>();
        let provider = state.ai.provider_id();
        let (guard, key, folder, t) = state.with_workspace(|ws| {
            let (folder, t) = write_input(ws, &state.appdata, provider, &target, tutorial)?;
            Ok((ws.guard.clone(), root_key(ws), folder, t))
        })?;
        match &target {
            WriteTarget::Export { .. } => {
                let chosen = NativeSaveDialog { app: &handle }
                    .pick_folder(guard.root())
                    .ok_or(AppError::SaveCancelled)?;
                share::export(guard.root(), &chosen, &t)
            }
            WriteTarget::Share { id } => {
                let written = share::write(&guard, &folder, &t)?;
                if let Some(readme) = &written.readme {
                    state.appdata.set_tutorial_shared_as(&key, id, readme)?;
                }
                Ok(written)
            }
            WriteTarget::Shared { .. } => share::write(&guard, &folder, &t),
        }
    })
    .await
    .map_err(blocking_error)?
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

    #[test]
    fn shared_tutorials_are_listed_read_and_updated_only_with_the_same_id() {
        use std::sync::atomic::AtomicBool;

        use crate::graph;
        use crate::index::scanner;

        let dir = tree(&[("src/index/watcher.rs", "a\nb\nc\nd\ne\nf\ng\n")]);
        let guard = RootGuard::new(dir.path()).unwrap();
        let t = prepared(guard.root(), "mock", sample());
        let folder = share::share_folder(&guard, "docs/tutorials", &t, None).unwrap();
        share::write(&guard, &folder, &t).unwrap();
        let appdata = tempfile::tempdir().unwrap();
        let appdata = AppData::new(appdata.path().to_path_buf());
        let options = ScanOptions::default();
        let ws = Workspace::new(guard.clone(), 1, options.clone());
        let never = AtomicBool::new(false);
        let scanned = scanner::scan(guard.root(), &options, &never, &|_| {}).unwrap();
        *ws.index.write().unwrap() = Some(scanned.index);
        graph::build(&guard, &ws.index, &ws.graph, &never, &|_, _| {}).unwrap();

        let list = library(&ws, &appdata).unwrap();
        assert_eq!(list.len(), 1, "{list:?}");
        let readme = format!("{folder}/README.md");
        assert_eq!(
            list[0].reference,
            TutorialRef::Shared {
                rel_path: readme.clone()
            }
        );
        let written = t.chapters.iter().filter(|c| c.is_written()).count();
        assert_eq!(list[0].chapters_written as usize, written);
        let shared = TutorialRef::Shared {
            rel_path: readme.clone(),
        };
        assert_eq!(read_tutorial(&ws, &appdata, &shared).unwrap().id, t.id);

        let target = WriteTarget::Shared { rel_path: readme };
        let mut other = t.clone();
        other.id = "someone-else".to_owned();
        assert!(matches!(
            write_input(&ws, &appdata, "mock", &target, Some(other)),
            Err(AppError::NotATutorialFile(_))
        ));
        let mut changed = t.clone();
        changed.intro = "A new intro.".to_owned();
        let (f, next) = write_input(&ws, &appdata, "mock", &target, Some(changed)).unwrap();
        assert_eq!(f, folder);
        let plan = share::plan(&guard, &f, &next).unwrap();
        assert_eq!(plan.files[0].state, share::PlannedState::Changed);
        assert!(
            plan.files[1..]
                .iter()
                .all(|p| p.state == share::PlannedState::Unchanged)
        );

        // Shared from a private tutorial: the same tutorial, one row, the private one.
        let key = root_key(&ws);
        appdata.save_private_tutorial(&key, t.clone()).unwrap();
        let readme = format!("{folder}/README.md");
        appdata
            .set_tutorial_shared_as(&key, &t.id, &readme)
            .unwrap();
        let list = library(&ws, &appdata).unwrap();
        assert_eq!(list.len(), 1, "{list:?}");
        assert_eq!(list[0].reference, TutorialRef::Private { id: t.id.clone() });
        assert_eq!(list[0].shared_as.as_deref(), Some(readme.as_str()));
        assert!(!list[0].shared_differs);
        // The shared copy changed since (a teammate's accepted review, pulled): it is another
        // version of the tutorial, listed on its own; the private one says it differs.
        share::write(&guard, &folder, &next).unwrap();
        let list = library(&ws, &appdata).unwrap();
        assert_eq!(
            list.iter().map(|s| &s.reference).collect::<Vec<_>>(),
            [&TutorialRef::Private { id: t.id.clone() }, &shared],
            "{list:?}"
        );
        assert!(list[0].shared_differs);
        assert!(!list[1].shared_differs);
        // Deleting the private copy keeps the progress: the shared copy, which stays, has it.
        appdata
            .save_tutorial_progress(
                &key,
                TutorialProgress {
                    tutorial_id: t.id.clone(),
                    xp: 25,
                    ..TutorialProgress::default()
                },
            )
            .unwrap();
        delete(&ws, &appdata, &t.id).unwrap();
        let list = library(&ws, &appdata).unwrap();
        assert_eq!(list.len(), 1, "{list:?}");
        assert_eq!(list[0].reference, shared);
        assert_eq!(list[0].progress.as_ref().map(|p| p.xp), Some(25));
        appdata.save_private_tutorial(&key, t.clone()).unwrap();
        // A copy that holds another tutorial (another id) is not this one: both are listed.
        let mut other = t.clone();
        other.id = "another-tutorial".to_owned();
        appdata.save_private_tutorial(&key, other).unwrap();
        appdata
            .set_tutorial_shared_as(&key, "another-tutorial", &readme)
            .unwrap();
        appdata
            .set_tutorial_shared_as(&key, &t.id, "docs/tutorials/elsewhere/README.md")
            .unwrap();
        assert_eq!(library(&ws, &appdata).unwrap().len(), 3);
    }

    #[test]
    fn freshness_relocates_a_private_tutorial_and_offers_it_for_a_shared_one() {
        use crate::learning::tutorial::freshness::Badge;

        const WATCHER: &str = "a\npub const DEBOUNCE_MS: u64 = 200;\nb\nc\nd\ne\nf\n";
        let dir = tree(&[("src/index/watcher.rs", WATCHER)]);
        let appdata = tempfile::tempdir().unwrap();
        let appdata = AppData::new(appdata.path().to_path_buf());
        let guard = RootGuard::new(dir.path()).unwrap();
        let ws = Workspace::new(guard.clone(), 1, ScanOptions::default());
        let mut t = sample();
        // Hashed now (the sample's recorded hash is a fake one).
        t.sources.clear();
        let t = prepared(guard.root(), "mock", t);
        appdata
            .save_private_tutorial(&root_key(&ws), t.clone())
            .unwrap();
        let private = TutorialRef::Private { id: t.id.clone() };
        let fresh = check_freshness(&ws, &appdata, &private).unwrap();
        assert_eq!(fresh.badge, Badge::UpToDate);
        assert!(fresh.affected.is_empty());
        let folder = share::share_folder(&guard, "docs/tutorials", &t, None).unwrap();
        let readme = share::write(&guard, &folder, &t).unwrap().readme.unwrap();

        // A line added above: every citation moved.
        std::fs::write(
            dir.path().join("src/index/watcher.rs"),
            format!("// new\n{WATCHER}"),
        )
        .unwrap();
        let moved = check_freshness(&ws, &appdata, &private).unwrap();
        assert!(moved.relocated_saved > 0);
        assert!(moved.relocated.is_none());
        let stored = read_tutorial(&ws, &appdata, &private).unwrap();
        assert_eq!(
            check_freshness(&ws, &appdata, &private)
                .unwrap()
                .relocated_saved,
            0
        );
        assert_ne!(stored, t);
        // The shared copy is not written: the relocated version is offered.
        let shared = TutorialRef::Shared {
            rel_path: readme.clone(),
        };
        let offered = check_freshness(&ws, &appdata, &shared).unwrap();
        assert_eq!(offered.relocated_saved, 0);
        assert!(offered.relocated.is_some());
        assert_eq!(read_tutorial(&ws, &appdata, &shared).unwrap(), t);

        // A cited line changed: maybe outdated, the steps citing it affected.
        std::fs::write(
            dir.path().join("src/index/watcher.rs"),
            format!("// new\n{}", WATCHER.replace("200", "500")),
        )
        .unwrap();
        let changed = check_freshness(&ws, &appdata, &private).unwrap();
        assert!(
            matches!(changed.badge, Badge::MaybeOutdated { .. }),
            "{changed:?}"
        );
        assert!(!changed.affected.is_empty());
    }

    #[test]
    fn verifying_stamps_saves_a_private_tutorial_and_only_returns_a_shared_one() {
        let dir = tree(&[("src/index/watcher.rs", "a\nb\nc\nd\ne\nf\ng\n")]);
        let appdata = tempfile::tempdir().unwrap();
        let appdata = AppData::new(appdata.path().to_path_buf());
        let guard = RootGuard::new(dir.path()).unwrap();
        let ws = Workspace::new(guard.clone(), 1, ScanOptions::default());
        let t = prepared(guard.root(), "mock", sample());
        appdata
            .save_private_tutorial(&root_key(&ws), t.clone())
            .unwrap();
        let private = TutorialRef::Private { id: t.id.clone() };
        // The sample's recorded hash is stale: verifying starts the check from now.
        assert_ne!(
            freshness::check(guard.root(), &t).badge,
            freshness::Badge::UpToDate
        );
        let v = verified(&ws, &appdata, &private).unwrap();
        assert!(v.verified.as_ref().is_some_and(|s| !s.date.is_empty()));
        assert_eq!(
            freshness::check(guard.root(), &v).badge,
            freshness::Badge::UpToDate
        );
        assert_eq!(read_tutorial(&ws, &appdata, &private).unwrap(), v);

        let folder = share::share_folder(&guard, "docs/tutorials", &t, None).unwrap();
        let readme = share::write(&guard, &folder, &t).unwrap().readme.unwrap();
        let before = std::fs::read_to_string(dir.path().join(&readme)).unwrap();
        let shared = TutorialRef::Shared {
            rel_path: readme.clone(),
        };
        let stamped = verified(&ws, &appdata, &shared).unwrap();
        assert!(stamped.verified.is_some());
        assert_eq!(
            std::fs::read_to_string(dir.path().join(&readme)).unwrap(),
            before
        );
        // Written after the confirmation: only the README changes.
        let plan = share::plan(&guard, &folder, &stamped).unwrap();
        let changed: Vec<&str> = plan
            .files
            .iter()
            .filter(|f| f.state != share::PlannedState::Unchanged)
            .map(|f| f.name.as_str())
            .collect();
        assert_eq!(changed, vec!["README.md"]);
    }
}
